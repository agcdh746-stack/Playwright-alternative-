'use strict';

// সব একই container এ — direct subprocess call
const { execFile } = require('child_process');

function tbp(args) {
  return new Promise((resolve) => {
    execFile('tbp', args.map(String), { timeout: 60000 }, (err, stdout, stderr) => {
      resolve({
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        code: err ? (err.code || 1) : 0
      });
    });
  });
}

module.exports = { tbp };
