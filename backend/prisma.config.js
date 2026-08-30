require('dotenv').config();
let defineConfig = (config) => config;

try {
  ({ defineConfig } = require('@prisma/config'));
} catch (error) {
  // Fallback for environments where Prisma's optional config helper
  // has not been installed yet.
}

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'node prisma/seed.js',
  },
});
