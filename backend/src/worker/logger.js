function createLogger(output = console) {
  const write = (level, event, fields = {}) => {
    const record = { timestamp: new Date().toISOString(), level, component: 'episode-worker', event, ...fields };
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    output[method](JSON.stringify(record));
  };
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

module.exports = { createLogger };
