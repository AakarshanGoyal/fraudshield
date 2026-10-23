// Loads everything the engine needs from the database: lookups + rules config.
const { configFromRows } = require('./util');

async function loadContext(prisma) {
  const [cities, merchants, countries, mccs, configRows] = await Promise.all([
    prisma.city.findMany(),
    prisma.merchant.findMany(),
    prisma.countryRisk.findMany(),
    prisma.mccCode.findMany(),
    prisma.ruleConfig.findMany(),
  ]);
  return {
    cfg: configFromRows(configRows),
    ctx: {
      cities: new Map(cities.map((c) => [c.city, c])),
      merchants: new Map(merchants.map((m) => [m.merchant_id, m])),
      countryRisk: new Map(countries.map((c) => [c.country_code, c.risk_level])),
      mccs: new Map(mccs.map((m) => [m.mcc, m])),
    },
  };
}

module.exports = { loadContext };
