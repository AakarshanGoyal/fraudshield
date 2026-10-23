const { audit } = require('./audit');

// Sets a card to BLOCKED (no-op if already blocked) and audits it. db may be a transaction client.
async function blockCard(db, cardId, actor, role, reason) {
  const card = await db.card.findUnique({ where: { card_id: cardId }, select: { card_status: true } });
  if (!card || card.card_status === 'BLOCKED') return false;
  await db.card.update({ where: { card_id: cardId }, data: { card_status: 'BLOCKED' } });
  await audit(db, { entity: 'CARD', entity_id: cardId, actor, role, action: 'BLOCKED',
    from_status: card.card_status, to_status: 'BLOCKED', comment: reason });
  return true;
}

module.exports = { blockCard };
