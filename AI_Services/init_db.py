#!/usr/bin/env python3
"""
Database initialization script
Run this ONCE to create the database and tables
"""
import os
from sqlalchemy import create_engine, text
from app.config import settings
from app.database import Base

def init_db():
    print("[1/3] Creating engine...")
    try:
        engine = create_engine(settings.database_url)
        print(f"  ✓ Connected to: {settings.database_url}")
    except Exception as e:
        print(f"  ✗ Failed to connect: {e}")
        print("\n[ERROR] PostgreSQL connection failed.")
        print("Make sure PostgreSQL is running and customer_care database exists.")
        print("Create database with: psql -U postgres -c \"CREATE DATABASE customer_care;\"")
        return False
    
    print("\n[2/3] Creating tables...")
    try:
        Base.metadata.create_all(bind=engine)
        print("  ✓ All tables created successfully")
    except Exception as e:
        print(f"  ✗ Failed to create tables: {e}")
        return False
    
    print("\n[3/3] Verifying tables...")
    try:
        inspector = __import__('sqlalchemy').inspect(engine)
        tables = inspector.get_table_names()
        print(f"  ✓ Found {len(tables)} tables: {', '.join(tables)}")
    except Exception as e:
        print(f"  ✗ Failed to verify: {e}")
        return False
    
    print("\n✓ Database initialization complete!")
    return True

if __name__ == "__main__":
    print("=" * 60)
    print("ResolveX - Database Initialization")
    print("=" * 60 + "\n")
    
    success = init_db()
    exit(0 if success else 1)
