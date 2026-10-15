import os
import pandas as pd
import plotly.express as px
import sqlite3
from sqlalchemy import create_engine
from crewai import Agent, Task, Crew, LLM
from crewai.tools import BaseTool
from dotenv import load_dotenv

load_dotenv()  # .env se DB_URL padhne ke liye (password code me nahi rahega)

# [ADDED] FastAPI (main.py) ke liye last sql/dataframe yahan save hoga
LAST_RESULT = {"sql": "", "df": None}


# Custom CodeInterpreterTool class (Database connection support ke sath aapke pattern mein)
class CodeInterpreterTool(BaseTool):
    name: str = "CodeInterpreterTool"
    description: str = "Executes python code to query databases, process data, and generate visualizations."
    db_url: str = os.getenv("DB_URL", "")

    def __init__(self, db_url=None, **kwargs):
        super().__init__(**kwargs)
        if db_url:
            self.db_url = db_url
        try:
            print("Database URL initialized successfully.")
        except Exception as e:
            print(f"Database URL initialization error: {e}")

    def _run(self, code: str) -> str:
        try:
            # Ek hi namespace use hota hai, warna exec ke andar ke functions/comprehensions
            # upar define kiye variables (jaise sql, engine) dekh nahi paate.
            env = {
                "pd": pd,
                "px": px,
                "sqlite3": sqlite3,
                "create_engine": create_engine,
                "DB_URL": self.db_url
            }
            exec(code, env)
            # chart/table ke liye df aur sql save karo
            df = env.get("df")
            result = env.get("result")
            if isinstance(df, pd.DataFrame):
                LAST_RESULT["df"] = df
            elif isinstance(result, pd.DataFrame):  # agent ne result me df de diya ho
                LAST_RESULT["df"] = result
            if env.get("sql"):
                LAST_RESULT["sql"] = str(env["sql"])

            # Agent ka output 'result' variable se fetch hoga
            output = result if result is not None else "Code executed successfully."
            return str(output)
        except Exception as e:
            return f"Error executing code: {e}"


try:
    MODEL_path = LLM(
        model="openai/qwen",
        base_url="http://localhost:8000/v1",
        api_key="not-needed",
        temperature=0.1,
        max_tokens=2048
    )
except Exception as e:
    print(f"your model loading error :{e}")
    raise SystemExit(1)


def main():
    # Aap yahan apna Database URL badal sakte hain (SQLite, PostgreSQL, Snowflake, etc.)
    DB_URL = os.getenv("DB_URL", "")
    
    code_interpreter = CodeInterpreterTool(db_url=DB_URL)

    SQL_agent = Agent(
        role="Senior SQL Developer and Data Analyst",
        goal="Given a database schema and a natural language question, write precise SQL queries, execute them using python, and analyze data.",
        backstory="""You are an expert database engineer and data analyst. You have access to a global variable 'DB_URL'. 
        You can write clean, optimized Python code using pandas/sqlalchemy and DB_URL to query databases, fetch data, and store the final output in 'result'.""",
        verbose=True,
        llm=MODEL_path,
        allow_delegation=False,
        tools=[code_interpreter] 
    )

    while True:
        print("\nstop karne ke liye 'exit' dabaye")
        user = input("enter your QUERY:- ")

        if user.strip().lower() == 'exit':
            break

        agent_task = Task(
            description=f"""Analyze the user request: '{user}'. 
            - You are connected to the database using the connection string stored in the global variable `DB_URL`.
            - Write Python code to connect using `create_engine(DB_URL)`, execute the appropriate SQL query, and store the output data in pandas.
            - Save the final output text or insights inside a variable named `result`.""",
            expected_output="The SQL query in a ```sql block, then a heading 'Key insights:' followed by 3-5 short bullet points with real numbers from the data.",
            agent=SQL_agent
        )

        sql_crew = Crew(
            agents=[SQL_agent],
            tasks=[agent_task],
            verbose=False
        )

        try:
            result = sql_crew.kickoff()
            print("\n--- Output ---")
            print(result)
        except Exception as g:
            print(f"SQL generation/visualization error: {g}")


if __name__ == "__main__":
    main()