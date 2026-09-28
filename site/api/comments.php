<?php
/**
 * 作品ページのコメントの読み書き。
 *
 *   GET  comments.php?work=<作品ID>     その作品のコメント（古い順）
 *   GET  comments.php?recent=1           サイト全体の新しいコメントと、作品ごとのコメント数
 *   POST action=post   work, name, body, spoiler(1 ならネタバレ), key, website(空であること)
 *   POST action=report work, id          通報。HIDE_REPORTS 人から通報されると自動で隠れる
 *   POST action=delete work, id, key     書いた本人による削除（key は書き込んだブラウザに残る）
 */
declare(strict_types=1);
define('NAROU_API', 1);
require __DIR__ . '/lib.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ほかのサイトのページから書き込ませない
if ($method === 'POST' && !empty($_SERVER['HTTP_ORIGIN'])) {
    $origin = parse_url((string)$_SERVER['HTTP_ORIGIN'], PHP_URL_HOST);
    $host = preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? ''));
    if ($origin !== $host) {
        fail('このページからは書き込めません。', 403);
    }
}

try {
    if ($method === 'GET') {
        if (!empty($_GET['recent'])) {
            $d = read_store(DATA_DIR . '/recent.php', ['items' => [], 'counts' => []]);
            $idx = works_index();
            $items = [];
            foreach (array_slice($d['items'], 0, 20) as $r) {
                if (!isset($idx[$r['work']])) {
                    continue;
                }
                $r['title'] = $idx[$r['work']]['title'];
                $r['path'] = $idx[$r['work']]['path'];
                $items[] = $r;
            }
            json_out(['ok' => true, 'items' => $items, 'counts' => (object)$d['counts']]);
        }
        $work = (string)($_GET['work'] ?? '');
        if (!valid_work_id($work)) {
            fail('作品の指定が正しくありません。');
        }
        $d = read_store(work_file($work), ['next' => 1, 'items' => []]);
        $list = array_values(array_map('public_comment', array_filter($d['items'], 'visible')));
        json_out(['ok' => true, 'work' => $work, 'count' => count($list), 'items' => $list]);
    }

    if ($method !== 'POST') {
        fail('対応していない操作です。', 405);
    }

    $action = (string)($_POST['action'] ?? '');
    $work = (string)($_POST['work'] ?? '');
    if (!valid_work_id($work) || !isset(works_index()[$work])) {
        fail('作品の指定が正しくありません。');
    }

    if ($action === 'post') {
        // 人には見えない欄。ここに何か入っていたら機械の書き込みとみなす
        if (!empty($_POST['website'])) {
            fail('書き込めませんでした。');
        }
        $name = clean_text((string)($_POST['name'] ?? ''), false);
        $body = clean_text((string)($_POST['body'] ?? ''), true);
        $key = (string)($_POST['key'] ?? '');
        if ($name === '') {
            $name = DEFAULT_NAME;
        }
        if ($body === '') {
            fail('コメントを入力してください。');
        }
        if (mb_strlen($name) > MAX_NAME) {
            fail('名前は ' . MAX_NAME . ' 文字までです。');
        }
        if (mb_strlen($body) > MAX_BODY) {
            fail('コメントは ' . MAX_BODY . ' 文字までです。');
        }
        if (substr_count($body, "\n") >= MAX_LINES) {
            fail('改行が多すぎます。');
        }
        if (!preg_match('/^[0-9a-f]{32}$/', $key)) {
            fail('ページを読み込み直してから書き込んでください。');
        }
        if (has_ng($name . "\n" . $body)) {
            fail('書き込めない言葉（または URL・メールアドレス・電話番号）が含まれています。', 422);
        }

        $me = ip_key();
        $now = time();
        $rate = update_store(DATA_DIR . '/rate.php', [], function (array &$d) use ($me, $now) {
            foreach ($d as $k => $times) {
                $d[$k] = array_values(array_filter($times, function ($t) use ($now) {
                    return $now - $t < 3600;
                }));
                if (!$d[$k]) {
                    unset($d[$k]);
                }
            }
            $mine = $d[$me] ?? [];
            if ($mine && $now - max($mine) < RATE_GAP) {
                return 'gap';
            }
            if (count($mine) >= RATE_HOUR) {
                return 'hour';
            }
            $mine[] = $now;
            $d[$me] = $mine;
            return 'ok';
        });
        if ($rate === 'gap') {
            fail('続けて書き込むときは、少し時間をおいてください。', 429);
        }
        if ($rate === 'hour') {
            fail('書き込みが多すぎます。しばらくしてからもう一度お試しください。', 429);
        }

        $comment = [
            'id' => bin2hex(random_bytes(6)),
            'no' => 0,
            'name' => $name,
            'body' => $body,
            'at' => gmdate('Y-m-d\TH:i:s\Z', $now),
            'uid' => day_uid(),
            'ip' => $me,
            'sp' => !empty($_POST['spoiler']),
            'del' => hash('sha256', $key),
            'rep' => [],
        ];
        $saved = update_store(work_file($work), ['next' => 1, 'items' => []], function (array &$d) use (&$comment, $me, $body) {
            foreach (array_slice($d['items'], -20) as $c) {
                if ($c['ip'] === $me && $c['body'] === $body) {
                    return 'dup';
                }
            }
            $comment['no'] = (int)$d['next'];
            $d['next'] = $comment['no'] + 1;
            $d['items'][] = $comment;
            if (count($d['items']) > MAX_PER_WORK) {
                $d['items'] = array_slice($d['items'], -MAX_PER_WORK);
            }
            return count(array_filter($d['items'], 'visible'));
        });
        if ($saved === 'dup') {
            fail('同じコメントがすでに書き込まれています。', 409);
        }

        update_store(DATA_DIR . '/recent.php', ['items' => [], 'counts' => []], function (array &$d) use ($work, $comment, $saved) {
            array_unshift($d['items'], [
                'work' => $work,
                'id' => $comment['id'],
                'no' => $comment['no'],
                'name' => $comment['name'],
                'body' => $comment['sp'] ? '' : mb_substr($comment['body'], 0, 80),
                'sp' => $comment['sp'],
                'at' => $comment['at'],
            ]);
            $d['items'] = array_slice($d['items'], 0, RECENT_MAX);
            $d['counts'][$work] = $saved;
            return true;
        });
        json_out(['ok' => true, 'item' => public_comment($comment)]);
    }

    if ($action === 'report' || $action === 'delete') {
        $id = (string)($_POST['id'] ?? '');
        if (!preg_match('/^[0-9a-f]{12}$/', $id)) {
            fail('コメントの指定が正しくありません。');
        }
        $me = ip_key();
        $keyHash = hash('sha256', (string)($_POST['key'] ?? ''));
        $items = null;
        $res = update_store(work_file($work), ['next' => 1, 'items' => []], function (array &$d) use ($action, $id, $me, $keyHash, &$items) {
            foreach ($d['items'] as $i => $c) {
                if ($c['id'] !== $id) {
                    continue;
                }
                if ($action === 'delete') {
                    if (!hash_equals($c['del'], $keyHash)) {
                        return 'forbidden';
                    }
                    $d['items'][$i]['removed'] = true;
                    $d['items'][$i]['removedBy'] = 'author';
                } else {
                    if ($c['ip'] === $me) {
                        return 'self';
                    }
                    if (!in_array($me, $c['rep'], true)) {
                        $d['items'][$i]['rep'][] = $me;
                    }
                    if (count($d['items'][$i]['rep']) >= HIDE_REPORTS) {
                        $d['items'][$i]['hidden'] = true;
                    }
                }
                $items = $d['items'];
                return 'ok';
            }
            return false;
        });
        if ($res === false) {
            fail('コメントが見つかりませんでした。', 404);
        }
        if ($res === 'forbidden') {
            fail('このコメントは削除できません。', 403);
        }
        if ($res === 'self') {
            fail('自分のコメントは通報できません。');
        }
        if ($items !== null) {
            refresh_recent($work, $items);
        }
        json_out(['ok' => true]);
    }

    fail('対応していない操作です。');
} catch (Throwable $e) {
    error_log('comments.php: ' . $e->getMessage());
    fail('サーバーでエラーが起きました。時間をおいてもう一度お試しください。', 500);
}
