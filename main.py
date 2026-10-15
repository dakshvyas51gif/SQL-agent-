import datetime
import json
import os
import re
import tempfile
import threading

import pandas as pd
import plotly.express as px
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

import agent
import use_db
from crewai import Agent, Task, Crew

app = FastAPI(title="Conversational BI")
BASE = os.path.dirname(os.path.abspath(__file__))
# index.html/script.js/style.css agar templates/ folder me hain to wahin se serve hongi
FRONT = os.path.join(BASE, "templates") if os.path.isdir(os.path.join(BASE, "templates")) else BASE

# Startup par dikhao ki kaunsi index.html serve ho rahi hai (purani file pakadne ke liye)
try:
    _html = open(os.path.join(FRONT, "index.html"), encoding="utf-8").read()
    print(f"[Frontend] Serving from: {FRONT}")
    print("[Frontend] OK: Conversational BI page mili" if "Conversational BI" in _html
          else "[Frontend] WARNING: yeh index.html purani/alag hai (Conversational BI nahi hai)!")
except Exception as _e:
    print(f"[Frontend] index.html nahi mili in {FRONT}: {_e}")

NO_CACHE = {"Cache-Control": "no-store"}  # browser purani file cache na kare
lock = threading.Lock()  # agent.LAST_RESULT global hai, isliye ek time pe ek query


class Ask(BaseModel):
    question: str


def clean_df(df: pd.DataFrame) -> pd.DataFrame:
    # Postgres Decimal columns object type me aate hain, unhe number bana do
    df = df.copy()
    for c in df.columns:
        if pd.api.types.is_object_dtype(df[c]) or pd.api.types.is_string_dtype(df[c]):
            try:
                df[c] = pd.to_numeric(df[c])
                continue
            except (ValueError, TypeError):
                pass
            # date/datetime objects ko real datetime bana do (line chart ke liye)
            first = df[c].dropna().iloc[0] if df[c].notna().any() else None
            if isinstance(first, (datetime.date, datetime.datetime)):
                df[c] = pd.to_datetime(df[c])
    return df


def build_figure(df: pd.DataFrame, question: str = ""):
    """Data dekh kar best chart khud select hota hai: line / pie / (grouped) bar."""
    if df is None or df.empty or len(df.columns) < 2:
        return None
    x = df.columns[0]
    ys = [c for c in df.columns[1:] if pd.api.types.is_numeric_dtype(df[c])]
    if not ys:
        return None
    df = df.head(100).copy()
    q = question.lower()
    is_time = pd.api.types.is_datetime64_any_dtype(df[x])
    many_numeric_x = pd.api.types.is_numeric_dtype(df[x]) and len(df) > 12
    wants_share = any(w in q for w in ("share", "percent", "proportion", "distribution", "breakdown", "ratio", "contribution"))

    if is_time or many_numeric_x:
        fig = px.line(df, x=x, y=ys, markers=True)
    elif wants_share and len(ys) == 1 and 2 <= len(df) <= 8 and (df[ys[0]] >= 0).all():
        fig = px.pie(df, names=x, values=ys[0])
    else:
        if pd.api.types.is_numeric_dtype(df[x]):
            df[x] = df[x].astype(str)  # year jaise numbers ko category bana do
        fig = px.bar(df, x=x, y=ys, barmode="group")
    return json.loads(fig.to_json())


def extract_sql(answer: str) -> str:
    m = re.search(r"```sql\s*(.*?)```", answer or "", flags=re.S | re.I)
    return m.group(1).strip() if m else ""


def extract_insights(answer: str):
    """Agent ke text se bullet-point insights nikalo (code block hata kar)."""
    text = re.sub(r"```.*?```", "", answer or "", flags=re.S)
    m = re.search(r"key insights?\W*", text, flags=re.I)
    if m:
        text = text[m.end():]
    lines = [re.sub(r"^[\s\-*\u2022\d.)]+", "", re.sub(r"\*+", "", ln)).strip(" #") for ln in text.splitlines()]
    return [ln for ln in lines if ln][:6]


def run_locked(question: str):
    """agent.py ka hi tool/model use karta hai (agent.py me kuch copy nahi hua)."""
    with lock:
        agent.LAST_RESULT["sql"] = ""
        agent.LAST_RESULT["df"] = None
        tool = agent.CodeInterpreterTool()  # DB_URL class ka apna hi use hota hai
        sql_agent = Agent(
            role="Senior SQL Developer and Data Analyst",
            goal="Given a database schema and a natural language question, write precise SQL queries, execute them using python, and analyze data.",
            backstory="""You are an expert database engineer and data analyst. You have access to a global variable 'DB_URL'. 
            You can write clean, optimized Python code using pandas/sqlalchemy and DB_URL to query databases, fetch data, and store the final output in 'result'.""",
            verbose=True,
            llm=agent.MODEL_path,
            allow_delegation=False,
            tools=[tool],
        )
        task = Task(
            description=f"""Analyze the user request: '{question}'. 
            - You are connected to the database using the connection string stored in the global variable `DB_URL`.
            - Write Python code to connect using `create_engine(DB_URL)`, execute the appropriate SQL query, and store the output data in pandas.
            - Keep the SQL text in a variable named `sql` and the DataFrame in a variable named `df`.
            - Save the final output text or insights inside a variable named `result`.
            - In your final answer give the SQL in a ```sql block, then 'Key insights:' with 3-5 short bullet points using real numbers.""",
            expected_output="The SQL query in a ```sql block, then a heading 'Key insights:' followed by 3-5 short bullet points with real numbers from the data.",
            agent=sql_agent,
        )
        result = Crew(agents=[sql_agent], tasks=[task], verbose=False).kickoff()
        return {"answer": str(result), "sql": agent.LAST_RESULT["sql"], "df": agent.LAST_RESULT["df"]}


@app.post("/api/ask")
async def ask(body: Ask):
    question = body.question.strip()
    if not question:
        raise HTTPException(400, "Question is empty")
    try:
        out = await run_in_threadpool(run_locked, question)
    except Exception as e:
        raise HTTPException(500, f"Agent error: {e}")

    df = out["df"]
    sql_text = out["sql"] or extract_sql(out["answer"])
    table = None
    figure = None
    if df is not None:
        df = clean_df(df)
        figure = build_figure(df, question)
        table = json.loads(df.head(200).to_json(orient="split", date_format="iso"))

    use_db.save_history(question, out["answer"], sql_text)
    return {
        "answer": out["answer"],
        "insights": extract_insights(out["answer"]),
        "sql": sql_text,
        "figure": figure,
        "table": table,
        "title": question,
    }


@app.get("/api/history")
async def history():
    return await run_in_threadpool(use_db.get_history)


# Speech-to-Text (Whisper). Pehli request pe model load hota hai.
_whisper = None


@app.post("/api/stt")
async def stt(audio: UploadFile = File(...)):
    global _whisper
    try:
        if _whisper is None:
            from faster_whisper import WhisperModel
            _whisper = WhisperModel("base", compute_type="int8")
    except ImportError:
        raise HTTPException(503, "Whisper not installed: pip install faster-whisper")

    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(await audio.read())
        path = f.name
    try:
        segments, _ = await run_in_threadpool(lambda: _whisper.transcribe(path))
        text = " ".join(s.text.strip() for s in segments).strip()
    finally:
        os.remove(path)
    return {"text": text}


# Frontend files (sirf yehi files serve hongi, .py files nahi)
@app.get("/")
async def index():
    return FileResponse(os.path.join(FRONT, "index.html"), headers=NO_CACHE)


@app.get("/script.js")
async def script():
    return FileResponse(os.path.join(FRONT, "script.js"), headers=NO_CACHE)


@app.get("/style.css")
async def style():
    return FileResponse(os.path.join(FRONT, "style.css"), headers=NO_CACHE)


# Run: uvicorn main:app --host 0.0.0.0 --port 8080
