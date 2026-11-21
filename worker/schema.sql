CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  recipient_name TEXT DEFAULT 'راضیه',
  whatsapp_number TEXT,
  baseline_weight REAL DEFAULT 116,
  target_protein TEXT DEFAULT '110-125',
  send_time TEXT,
  timezone TEXT DEFAULT 'Asia/Tehran',
  dietary_notes TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS weight_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weight REAL NOT NULL,
  recorded_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meal_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_date TEXT NOT NULL,
  meal_title TEXT,
  ingredients TEXT,
  instructions TEXT,
  calories INTEGER,
  protein REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS send_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  send_date TEXT NOT NULL,
  recipient TEXT,
  status TEXT,
  message TEXT,
  sent_at TEXT
);

INSERT OR IGNORE INTO app_settings (id) VALUES (1);

CREATE INDEX IF NOT EXISTS idx_send_date ON send_logs(send_date);
CREATE INDEX IF NOT EXISTS idx_meal_date ON meal_plans(meal_date);
CREATE INDEX IF NOT EXISTS idx_weight_recorded ON weight_entries(recorded_at);
