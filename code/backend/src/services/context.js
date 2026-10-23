// Caches lookups + rules config in memory. Config changes call invalidate().
const { prisma } = require('../db');
const { loadContext } = require('../engine/context');

let cached = null;

async function getContext() {
  if (!cached) cached = loadContext(prisma);
  return cached;
}

function invalidate() {
  cached = null;
}

module.exports = { getContext, invalidate };
