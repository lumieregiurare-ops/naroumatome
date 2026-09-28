<?php
/**
 * コメントの管理画面。新しいコメントを一覧し、削除・復元ができる。
 *
 * 使うには、サーバーの api/data/admin.php に次の 1 行を書いたファイルを置く（README 参照）。
 *   <?php return 'ここにパスワード';
 * このファイルは FTP の自動アップロードでは送られないので、ロリポップのファイルマネージャーなどで作る。
 */
declare(strict_types=1);
define('NAROU_API', 1);
require __DIR__ . '/lib.php';

session_name('narou_admin');
session_set_cookie_params(['lifetime' => 0, 'path' => '/api/', 'httponly' => true, 'samesite' => 'Strict', 'secure' => !empty($_SERVER['HTTPS'])]);
session_start();
header('X-Robots-Tag: noindex');
header('X-Frame-Options: DENY');

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

$passFile = DATA_DIR . '/admin.php';
$password = is_file($passFile) ? include $passFile : null;
$error = '';

if (!is_string($password) || $password === '') {
    $body = '<p>管理画面のパスワードが設定されていません。</p><p>サーバーの <code>api/data/admin.php</code> に、次の 1 行だけを書いたファイルを置いてください。</p><pre>&lt;?php return \'好きなパスワード\';</pre>';
    render('設定が必要です', $body);
    exit;
}

if (($_POST['do'] ?? '') === 'login') {
    if (hash_equals($password, (string)($_POST['password'] ?? ''))) {
        session_regenerate_id(true);
        $_SESSION['ok'] = true;
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
        header('Location: admin.php');
        exit;
    }
    sleep(2);
    $error = 'パスワードがちがいます。';
}
if (($_POST['do'] ?? '') === 'logout') {
    $_SESSION = [];
    session_destroy();
    header('Location: admin.php');
    exit;
}

if (empty($_SESSION['ok'])) {
    render('ログイン', ($error ? '<p class="err">' . h($error) . '</p>' : '') . '<form method="post"><input type="hidden" name="do" value="login"><input type="password" name="password" autofocus autocomplete="current-password"> <button>ログイン</button></form>');
    exit;
}

// ---------- 削除・復元 ----------
if (in_array($_POST['do'] ?? '', ['remove', 'restore'], true)) {
    if (!hash_equals((string)$_SESSION['csrf'], (string)($_POST['csrf'] ?? ''))) {
        http_response_code(400);
        exit('bad request');
    }
    $work = (string)($_POST['work'] ?? '');
    $id = (string)($_POST['id'] ?? '');
    if (valid_work_id($work) && preg_match('/^[0-9a-f]{12}$/', $id)) {
        $restore = $_POST['do'] === 'restore';
        $items = null;
        update_store(work_file($work), ['next' => 1, 'items' => []], function (array &$d) use ($id, $restore, &$items) {
            foreach ($d['items'] as $i => $c) {
                if ($c['id'] === $id) {
                    if ($restore) {
                        unset($d['items'][$i]['removed'], $d['items'][$i]['removedBy'], $d['items'][$i]['hidden']);
                        $d['items'][$i]['rep'] = [];
                    } else {
                        $d['items'][$i]['removed'] = true;
                        $d['items'][$i]['removedBy'] = 'admin';
                    }
                    $items = $d['items'];
                    return true;
                }
            }
            return false;
        });
        if ($items !== null) {
            refresh_recent($work, $items);
        }
    }
    header('Location: admin.php' . (!empty($_GET['f']) ? '?f=' . urlencode((string)$_GET['f']) : ''));
    exit;
}

// ---------- 一覧 ----------
$filter = (string)($_GET['f'] ?? 'all');
$idx = works_index();
$all = [];
foreach (glob(DATA_DIR . '/c/*.php') ?: [] as $file) {
    $work = basename($file, '.php');
    $d = read_store($file, ['items' => []]);
    foreach ($d['items'] as $c) {
        $c['work'] = $work;
        $all[] = $c;
    }
}
usort($all, function ($a, $b) {
    return strcmp($b['at'], $a['at']);
});
if ($filter === 'flagged') {
    $all = array_filter($all, function ($c) {
        return !empty($c['hidden']) || count($c['rep'] ?? []) > 0;
    });
} elseif ($filter === 'removed') {
    $all = array_filter($all, function ($c) {
        return !empty($c['removed']);
    });
}
$all = array_slice(array_values($all), 0, 300);

$rows = '';
foreach ($all as $c) {
    $title = $idx[$c['work']]['title'] ?? $c['work'];
    $path = $idx[$c['work']]['path'] ?? '/';
    $state = !empty($c['removed']) ? '削除済み（' . ($c['removedBy'] === 'author' ? '本人' : '管理') . '）' : (!empty($c['hidden']) ? '通報で非表示' : '表示中');
    $btn = (!empty($c['removed']) || !empty($c['hidden']))
        ? '<button name="do" value="restore">復元</button>'
        : '<button name="do" value="remove" class="danger">削除</button>';
    $rows .= '<tr class="' . (visible($c) ? '' : 'off') . '"><td>' . h(date('n/j H:i', strtotime($c['at']))) . '</td>'
        . '<td><a href="' . h($path) . '#comments" target="_blank">' . h(mb_strimwidth($title, 0, 30, '…')) . '</a> #' . (int)$c['no'] . '</td>'
        . '<td><b>' . h($c['name']) . '</b> <small>ID:' . h($c['uid']) . '</small><br>' . nl2br(h($c['body'])) . '</td>'
        . '<td>' . h($state) . (count($c['rep'] ?? []) ? '<br><small>通報 ' . count($c['rep']) . '</small>' : '') . '</td>'
        . '<td><form method="post" action="admin.php?f=' . h($filter) . '"><input type="hidden" name="csrf" value="' . h($_SESSION['csrf']) . '"><input type="hidden" name="work" value="' . h($c['work']) . '"><input type="hidden" name="id" value="' . h($c['id']) . '">' . $btn . '</form></td></tr>';
}
$tabs = '';
foreach (['all' => 'すべて', 'flagged' => '通報あり', 'removed' => '削除済み'] as $k => $label) {
    $tabs .= $k === $filter ? '<b>' . $label . '</b> ' : '<a href="admin.php?f=' . $k . '">' . $label . '</a> ';
}
render('コメント管理', '<p>' . $tabs . '</p><form method="post" class="logout"><input type="hidden" name="do" value="logout"><button>ログアウト</button></form>'
    . ($rows ? '<table><thead><tr><th>日時</th><th>作品</th><th>コメント</th><th>状態</th><th></th></tr></thead><tbody>' . $rows . '</tbody></table>' : '<p>コメントはありません。</p>'));

function render(string $title, string $body): void
{
    echo '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' . h($title) . '｜なろう系まとめ</title>'
        . '<style>body{font:14px/1.6 system-ui,sans-serif;margin:24px;color:#222}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:8px;vertical-align:top;text-align:left}tr.off td{color:#999}button{padding:4px 12px}.danger{color:#b00}.err{color:#b00}.logout{position:absolute;top:16px;right:24px}pre{background:#f4f4f4;padding:8px}</style></head><body>'
        . '<h1>' . h($title) . '</h1>' . $body . '</body></html>';
}
