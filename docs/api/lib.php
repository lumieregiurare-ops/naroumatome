<?php
/**
 * コメント機能の共通部品（comments.php と admin.php から読む）。
 *
 * 保存先は api/data/ の下。ファイルはすべて .php にして先頭に exit を書いておく。
 * .htaccess が効かないサーバーでも、中身（IP のハッシュなど）が外から読めないようにするため。
 *   data/c/<作品ID>.php  作品ごとのコメント
 *   data/recent.php       サイト全体の新しいコメント（トップに出す）
 *   data/rate.php         連投を防ぐための書き込み時刻（1 時間で消える）
 *   data/salt.php         IP をハッシュにするときの秘密の値（最初の書き込みで作る）
 *   data/admin.php        管理画面のパスワード（手で置く。README 参照）
 *
 * IP アドレスはそのまま保存しない。salt を混ぜたハッシュにして、連投の判定と
 * 「ID:」の表示（日付が変わると変わる）にだけ使う。
 */
declare(strict_types=1);

if (!defined('NAROU_API')) {
    http_response_code(403);
    exit;
}

const DATA_DIR = __DIR__ . '/data';
const GUARD = "<?php exit; ?>\n";
const MAX_BODY = 500;       // 本文の文字数
const MAX_NAME = 20;        // 名前の文字数
const MAX_LINES = 15;       // 本文の行数
const MAX_PER_WORK = 2000;  // 1 作品に残すコメントの数（超えたら古いものから消す）
const HIDE_REPORTS = 3;     // この数の人から通報されたら自動で隠す
const RATE_GAP = 20;        // 同じ人の書き込みの間隔（秒）
const RATE_HOUR = 10;       // 同じ人が 1 時間に書き込める数
const RECENT_MAX = 50;
const DEFAULT_NAME = '名無しの読者';

mb_internal_encoding('UTF-8');
date_default_timezone_set('Asia/Tokyo');

function ensure_data_dir(): void
{
    if (!is_dir(DATA_DIR . '/c')) {
        @mkdir(DATA_DIR . '/c', 0705, true);
    }
    $ht = DATA_DIR . '/.htaccess';
    if (!is_file($ht)) {
        @file_put_contents($ht, "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
    }
}

function strip_guard(string $s): string
{
    return strncmp($s, GUARD, strlen(GUARD)) === 0 ? substr($s, strlen(GUARD)) : $s;
}

function read_store(string $path, array $default): array
{
    if (!is_file($path)) {
        return $default;
    }
    $s = @file_get_contents($path);
    if ($s === false || $s === '') {
        return $default;
    }
    $j = json_decode(strip_guard($s), true);
    return is_array($j) ? $j : $default;
}

/**
 * ファイルをロックして読み、$fn で書き換えて書き戻す。$fn の戻り値をそのまま返す。
 * $fn が false を返したときは書き戻さない。
 */
function update_store(string $path, array $default, callable $fn)
{
    ensure_data_dir();
    $fp = fopen($path, 'c+');
    if (!$fp) {
        throw new RuntimeException('保存先を開けませんでした');
    }
    try {
        flock($fp, LOCK_EX);
        $s = stream_get_contents($fp);
        $data = $s ? json_decode(strip_guard($s), true) : null;
        if (!is_array($data)) {
            $data = $default;
        }
        $result = $fn($data);
        if ($result !== false) {
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, GUARD . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            fflush($fp);
        }
        return $result;
    } finally {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function salt(): string
{
    $path = DATA_DIR . '/salt.php';
    $j = read_store($path, []);
    if (!empty($j['salt'])) {
        return $j['salt'];
    }
    return update_store($path, [], function (array &$d) {
        if (empty($d['salt'])) {
            $d['salt'] = bin2hex(random_bytes(16));
        }
        return $d['salt'];
    });
}

function client_ip(): string
{
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/** 連投・通報の判定に使う、人ごとの値（IP そのものは残さない） */
function ip_key(): string
{
    return substr(hash('sha256', salt() . '|' . client_ip()), 0, 16);
}

/** 画面に出す ID。日付が変わると別の値になる */
function day_uid(): string
{
    $h = hash('sha256', salt() . '|uid|' . client_ip() . '|' . date('Ymd'), true);
    return substr(strtr(base64_encode($h), '+/', 'Ab'), 0, 8);
}

function work_file(string $work): string
{
    return DATA_DIR . '/c/' . $work . '.php';
}

function valid_work_id(string $id): bool
{
    return (bool)preg_match('/^[a-z0-9][a-z0-9-]{0,39}$/', $id);
}

/** 作品の一覧（ページを作るときに docs/data/works-index.json に書き出している） */
function works_index(): array
{
    static $idx = null;
    if ($idx === null) {
        $s = @file_get_contents(__DIR__ . '/../data/works-index.json');
        $j = $s ? json_decode($s, true) : null;
        $idx = is_array($j) ? $j : [];
    }
    return $idx;
}

// ---------- NG ワード ----------

/** ひらがな・小文字にして、空白と記号を抜く（「シ ネ」「ｼﾈ」も「しね」になる） */
function ng_normalize(string $s): string
{
    $t = mb_convert_kana($s, 'asKV');
    $t = mb_convert_kana($t, 'c');
    $t = mb_strtolower($t);
    return (string)preg_replace('/[\s\p{P}\p{S}]+/u', '', $t);
}

function ng_rules(): array
{
    static $rules = null;
    if ($rules === null) {
        $s = @file_get_contents(__DIR__ . '/ngwords.json');
        $j = $s ? json_decode($s, true) : null;
        $rules = [
            'words' => array_values(array_filter(array_map('ng_normalize', $j['words'] ?? []), 'strlen')),
            'allow' => array_values(array_filter(array_map('ng_normalize', $j['allow'] ?? []), 'strlen')),
            'patterns' => $j['patterns'] ?? [],
        ];
    }
    return $rules;
}

/** NG に当たれば true */
function has_ng(string $text): bool
{
    $r = ng_rules();
    $raw = mb_convert_kana($text, 'as');
    foreach ($r['patterns'] as $p) {
        if (@preg_match('~' . str_replace('~', '\~', $p) . '~iu', $raw)) {
            return true;
        }
    }
    $n = ng_normalize($text);
    foreach ($r['allow'] as $a) {
        $n = str_replace($a, '', $n);
    }
    foreach ($r['words'] as $w) {
        if (mb_strpos($n, $w) !== false) {
            return true;
        }
    }
    return false;
}

// ---------- 整形 ----------

/** 制御文字を落とし、改行をそろえ、3 行以上の空行を詰める */
function clean_text(string $s, bool $multiline): string
{
    $s = str_replace(["\r\n", "\r"], "\n", $s);
    $s = (string)preg_replace('/[\x00-\x09\x0B-\x1F\x7F\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{FEFF}]/u', '', $s);
    if (!$multiline) {
        $s = str_replace("\n", ' ', $s);
    }
    $s = (string)preg_replace("/\n{3,}/", "\n\n", $s);
    return trim($s);
}

/** 画面に返す形（IP のハッシュや削除キーは出さない） */
function public_comment(array $c): array
{
    return [
        'id' => $c['id'],
        'no' => $c['no'],
        'name' => $c['name'],
        'body' => $c['body'],
        'at' => $c['at'],
        'uid' => $c['uid'],
        'sp' => !empty($c['sp']),
    ];
}

function visible(array $c): bool
{
    return empty($c['hidden']) && empty($c['removed']);
}

/** 作品ごとの表示中のコメント数と、新しいコメントの一覧から、消えたものを外す */
function refresh_recent(string $work, array $items): void
{
    $count = count(array_filter($items, 'visible'));
    $alive = [];
    foreach ($items as $c) {
        if (visible($c)) {
            $alive[$c['id']] = true;
        }
    }
    update_store(DATA_DIR . '/recent.php', ['items' => [], 'counts' => []], function (array &$d) use ($work, $count, $alive) {
        $d['counts'][$work] = $count;
        if ($count === 0) {
            unset($d['counts'][$work]);
        }
        $d['items'] = array_values(array_filter($d['items'], function ($r) use ($work, $alive) {
            return $r['work'] !== $work || isset($alive[$r['id']]);
        }));
        return true;
    });
}

function json_out(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $status = 400): void
{
    json_out(['ok' => false, 'message' => $message], $status);
}
