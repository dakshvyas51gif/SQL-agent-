import os
from dotenv import load_dotenv
from supabase import create_client, Client

# 1. Connection Initialization
load_dotenv()
supabase = None
try:
    url: str = os.getenv("SUPABASE_URL", "")
    key: str = os.getenv("SUPABASE_KEY", "")

    supabase: Client = create_client(url, key)
    print("Supabase client initialized successfully.")

except Exception as e:
    print(f"Error initializing Supabase client: {e}")


# 2. Table Creation Note:
# Run this SQL query ONCE in your Supabase Dashboard -> SQL Editor:
# -------------------------------------------------------------
# create table users (
#     id serial primary key,
#     user_query text,
#     agent_response_summery text,
#     agent_response_query text,
#     date_created timestamp default current_timestamp
# );
# -------------------------------------------------------------


# [ADDED] FastAPI (main.py) ke liye helper functions
def save_history(user_query, agent_response_summery, agent_response_query):
    try:
        supabase.table("users").insert({
            "user_query": user_query,
            "agent_response_summery": agent_response_summery,
            "agent_response_query": agent_response_query
        }).execute()
        return True
    except Exception as e:
        print(f"Error inserting data: {e}")
        return False


def get_history(limit=20):
    try:
        res = supabase.table("users").select("*").order("date_created", desc=True).limit(limit).execute()
        return res.data
    except Exception as e:
        print(f"Error reading history: {e}")
        return []



# 3. Data Insertion Loop
if __name__ == "__main__":
    print("\n--- Starting Data Entry (Type 'exit' in query to stop) ---")
    while True:
        user_query = input("Enter your query: ")
        if user_query.lower() == 'exit':
            print("Exiting...")
            break
        
        agent_response_summery = input("Enter agent response summery: ")
        agent_response_query = input("Enter agent response query: ")
    
        try:
            # Prepare data dictionary for Supabase
            data = {
                "user_query": user_query,
                "agent_response_summery": agent_response_summery,
                "agent_response_query": agent_response_query
            }
        
            # Insert into Supabase 'users' table
            response = supabase.table("users").insert(data).execute()
            print("Data inserted successfully!\n")
        
        except Exception as e:
            print(f"Error inserting data: {e}\n")