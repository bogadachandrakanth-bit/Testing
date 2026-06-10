const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  console.log('--- NEXUSGATE RELATIONAL DATABASE METRICS ---\n');

  // 1. Users Table
  db.all("SELECT id, name, email, joined FROM users", [], (err, users) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(`[Table: users] Total records: ${users.length}`);
    console.log(JSON.stringify(users, null, 2));
    console.log('\n----------------------------------------\n');
    
    // 2. Login Counts Table
    db.all("SELECT email, count FROM login_counts", [], (err, logins) => {
      if (err) {
        console.error(err);
        return;
      }
      console.log(`[Table: login_counts] Total records: ${logins.length}`);
      console.log(JSON.stringify(logins, null, 2));
      console.log('\n----------------------------------------\n');

      // 3. Activity Logs Table
      db.all("SELECT id, email, action, status, ip, timestamp FROM activity_logs ORDER BY id DESC", [], (err, logs) => {
        if (err) {
          console.error(err);
          return;
        }
        console.log(`[Table: activity_logs] Total records: ${logs.length}`);
        console.log(JSON.stringify(logs, null, 2));
        db.close();
      });
    });
  });
});
