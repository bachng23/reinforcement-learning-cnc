-- Null distinguishes legacy sessions. GET derives retained trace without writing.
ALTER TABLE "demo_sessions" ADD COLUMN "work_orders_json" JSONB;
