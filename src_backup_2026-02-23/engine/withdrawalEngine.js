async function processSingleWithdrawal(client, withdrawal) {
  const reference = withdrawal.reference;

  await client.query(
    "UPDATE withdrawals SET status = 'processing', updated_at = NOW() WHERE id = $1",
    [withdrawal.id]
  );

  try {
    // Replace with real payout call
    await fakePayout();

    await client.query(
      "UPDATE withdrawals SET status = 'completed', updated_at = NOW() WHERE id = $1",
      [withdrawal.id]
    );

  } catch (err) {

    // Refund wallet atomically using same client
    await client.query(
      "SELECT wallet_credit($1,$2,$3)",
      [withdrawal.user_id, withdrawal.amount, `refund_${reference}`]
    );

    await client.query(
      "UPDATE withdrawals SET status = 'failed', updated_at = NOW() WHERE id = $1",
      [withdrawal.id]
    );

    throw err;
  }
}
