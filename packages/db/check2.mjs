import postgres from 'postgres';
for (const dbName of ['lore', 'lore_test']) {
  try {
    const sql = postgres(`postgresql://lore:lore@localhost:5432/${dbName}`, { max: 1 });
    const who = await sql`select current_database() as db, count(*)::int as n from chats`;
    const msgs = await sql`select count(*)::int as n from chat_messages`;
    console.log(dbName, who[0], 'messages:', msgs[0].n);
    await sql.end();
  } catch (e) {
    console.log(dbName, 'error:', e.message);
  }
}