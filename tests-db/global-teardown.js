// After the database tests: point the PHP back at the real database.
// The hop_app_test database is kept, so you can look at it in phpMyAdmin.

const fs = require('fs');
const { LOCAL_CONFIG, LOCAL_CONFIG_MARK } = require('./db');

module.exports = async () => {
  if (fs.existsSync(LOCAL_CONFIG) && fs.readFileSync(LOCAL_CONFIG, 'utf8').includes(LOCAL_CONFIG_MARK)) {
    fs.rmSync(LOCAL_CONFIG);
  }
};
