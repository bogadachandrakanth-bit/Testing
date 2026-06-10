const path = require('path');
const fs = require('fs');

const isVercel = process.env.VERCEL;
const dbDir = isVercel ? '/tmp' : path.resolve(__dirname);

const paths = {
  users: path.join(dbDir, 'users_table.json'),
  login_counts: path.join(dbDir, 'login_counts_table.json'),
  activity_logs: path.join(dbDir, 'activity_logs_table.json')
};

function readTable(tableName) {
  try {
    if (!fs.existsSync(paths[tableName])) {
      return [];
    }
    const data = fs.readFileSync(paths[tableName], 'utf8');
    return JSON.parse(data || '[]');
  } catch (e) {
    console.error(`Error reading table ${tableName}:`, e);
    return [];
  }
}

console.log('--- NEXUSGATE RELATIONAL DATABASE METRICS ---\n');

// 1. Users Table
const users = readTable('users');
console.log(`[Table: users] Total records: ${users.length}`);
console.log(JSON.stringify(users.map(u => ({ id: u.id, name: u.name, email: u.email, joined: u.joined })), null, 2));
console.log('\n----------------------------------------\n');

// 2. Login Counts Table
const logins = readTable('login_counts');
console.log(`[Table: login_counts] Total records: ${logins.length}`);
console.log(JSON.stringify(logins, null, 2));
console.log('\n----------------------------------------\n');

// 3. Activity Logs Table
const logs = readTable('activity_logs');
console.log(`[Table: activity_logs] Total records: ${logs.length}`);
console.log(JSON.stringify(logs, null, 2));
