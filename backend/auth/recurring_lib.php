<?php
// Recurring top ups: shared code for recurring.php and session.php.
//
// WampServer has no background jobs, so a due top up is added the next time
// the person opens the app: session.php (card page) and recurring.php call
// recurring_run_due() first.
//
// Each top up is saved as an 'auto top up' transaction with the reference
// 'auto_<recurring_id>_<date>' in the UNIQUE column stripe_payment_id, so the
// same payment day can never be added twice.

const RECURRING_INTERVALS = [
    'weekly'      => 'Every week',
    'fortnightly' => 'Every 2 weeks',
    'monthly'     => 'Every month',
];

// The amounts offered on the page, in cents (EUR 5, 10, 20, 50)
const RECURRING_AMOUNTS = [500, 1000, 2000, 5000];

function recurring_today(): string {
    return (new DateTime('now', new DateTimeZone('Europe/Dublin')))->format('Y-m-d');
}

// The payment day after $date. Monthly keeps the start date's day of the month
// (or the last day of a shorter month, e.g. 31 Jan -> 28 Feb -> 31 Mar).
function recurring_next_date(string $date, string $interval, string $startDate): string {
    $d = new DateTime($date);
    if ($interval === 'weekly')      return $d->modify('+1 week')->format('Y-m-d');
    if ($interval === 'fortnightly') return $d->modify('+2 weeks')->format('Y-m-d');

    $day = (int) (new DateTime($startDate))->format('j');
    $d->modify('first day of next month');
    $d->setDate((int) $d->format('Y'), (int) $d->format('n'), min($day, (int) $d->format('t')));
    return $d->format('Y-m-d');
}

// The user's recurring top up as the page needs it, or null
function recurring_load(PDO $pdo, int $userId): ?array {
    $stmt = $pdo->prepare(
        'SELECT r.amount, r.interval_type, r.card_id, r.start_date, r.next_run_date, r.enabled, c.brand, c.last4
         FROM recurring_topups r
         LEFT JOIN saved_cards c ON c.card_id = r.card_id
         WHERE r.user_id = ?'
    );
    $stmt->execute([$userId]);
    $r = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$r) return null;

    return [
        'amount'         => (float) $r['amount'],
        'interval'       => $r['interval_type'],
        'interval_label' => RECURRING_INTERVALS[$r['interval_type']],
        'pay_with'       => $r['card_id'] ? $r['brand'] . ' •••• ' . $r['last4'] : 'Demo wallet',
        'card_id'        => $r['card_id'] ? (int) $r['card_id'] : null,
        'start_date'     => $r['start_date'],
        'next_run_date'  => $r['next_run_date'],
        'enabled'        => (bool) $r['enabled'],
    ];
}

// Adds every top up that is due today or earlier. Returns how many were added.
// While the Hop card is frozen or reported, due days are skipped (nothing is added).
function recurring_run_due(PDO $pdo, int $userId): int {
    $today = recurring_today();
    $added = 0;

    $pdo->beginTransaction();
    try {
        // Lock the user row first, the same as topup.php, so balances can't clash
        $stmt = $pdo->prepare('SELECT card_status FROM users WHERE user_id = ? FOR UPDATE');
        $stmt->execute([$userId]);
        $cardStatus = $stmt->fetchColumn();

        $stmt = $pdo->prepare('SELECT * FROM recurring_topups WHERE user_id = ? AND enabled = 1 FOR UPDATE');
        $stmt->execute([$userId]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($r && $r['next_run_date'] <= $today) {
            $insert = $pdo->prepare(
                "INSERT IGNORE INTO transactions (user_id, type, amount, stripe_payment_id)
                 VALUES (?, 'auto top up', ?, ?)"
            );
            $credit = $pdo->prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE user_id = ?');

            $next = $r['next_run_date'];
            while ($next <= $today) {
                if ($cardStatus === 'active') {
                    // In mock mode no real payment is made (see charge_payment() in topup.php)
                    $insert->execute([$userId, $r['amount'], 'auto_' . $r['recurring_id'] . '_' . $next]);
                    if ($insert->rowCount() === 1) {   // 0 = this day was already added
                        $credit->execute([$r['amount'], $userId]);
                        $added++;
                    }
                }
                $next = recurring_next_date($next, $r['interval_type'], $r['start_date']);
            }

            $pdo->prepare('UPDATE recurring_topups SET next_run_date = ? WHERE recurring_id = ?')
                ->execute([$next, $r['recurring_id']]);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return $added;
}
