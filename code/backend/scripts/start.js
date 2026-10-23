// Container entrypoint (plain Node, so Windows line endings can't break it):
// 1. apply Prisma migrations, 2. seed if the database is empty, 3. start the server.
const { execSync } = require('child_process');

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

async function main() {
  run('npx prisma migrate deploy');

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const customers = await prisma.customer.count();
  await prisma.$disconnect();

  if (customers === 0) {
    console.log('Database is empty: seeding from /data');
    run('node scripts/seed.js');
  } else {
    console.log(`Database already has ${customers} customers: skipping seed (run "npm run reset" to reload)`);
  }

  require('../src/server').start();
}

main().catch((e) => { console.error(e); process.exit(1); });
