<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) ? (int)$parts[1] : null;
$sub = $parts[2] ?? '';

function recruitment_contact_status(array $data): string
{
    $allowed = ['pending', 'contacted', 'no_answer', 'wrong_number'];
    return in_array(($data['contacted_status'] ?? 'pending'), $allowed, true) ? $data['contacted_status'] : 'pending';
}

function recruitment_work_result(array $data): string
{
    $allowed = ['undecided', 'will_work', 'wont_work', 'waiting_documents', 'arrived'];
    return in_array(($data['work_result'] ?? 'undecided'), $allowed, true) ? $data['work_result'] : 'undecided';
}

function recruitment_reaction(array $data): string
{
    $allowed = ['note', 'called', 'message', 'no_answer', 'interview', 'documents', 'hired', 'rejected', 'arrived'];
    return in_array(($data['reaction'] ?? 'note'), $allowed, true) ? $data['reaction'] : 'note';
}

function require_recruitment_candidate(int $id): void
{
    $stmt = db()->prepare('SELECT id FROM recruitment_candidates WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    if (!$stmt->fetchColumn()) {
        json_response(['ok' => false, 'error' => 'Candidate not found'], 404);
    }
}

if ($method === 'GET' && $id && $sub === 'comments') {
    require_permission('recruitment.view');
    require_recruitment_candidate($id);
    $stmt = db()->prepare('SELECT c.*, u.name AS created_by_name FROM recruitment_comments c LEFT JOIN users u ON u.id = c.created_by WHERE c.candidate_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT 100');
    $stmt->execute([$id]);
    json_response(['ok' => true, 'data' => $stmt->fetchAll()]);
}

if ($method === 'POST' && $id && $sub === 'comments') {
    $user = require_permission('recruitment.write');
    $data = read_json();
    require_recruitment_candidate($id);
    $contactedStatus = recruitment_contact_status($data);
    $workResult = recruitment_work_result($data);
    $reaction = recruitment_reaction($data);
    $comment = nullable_string($data, 'comment');
    $nextContactAt = datetime_or_null($data, 'next_contact_at');
    $arrivalDate = date_or_null($data, 'arrival_date');
    if (!$comment && $reaction === 'note') {
        json_response(['ok' => false, 'error' => 'Comment or reaction is required'], 422);
    }
    $stmt = db()->prepare('INSERT INTO recruitment_comments (candidate_id,reaction,contacted_status,work_result,comment,next_contact_at,arrival_date,created_by) VALUES (?,?,?,?,?,?,?,?)');
    $stmt->execute([
        $id,
        $reaction,
        $contactedStatus,
        $workResult,
        $comment,
        $nextContactAt,
        $arrivalDate,
        (int)$user['id'],
    ]);
    db()->prepare('UPDATE recruitment_candidates SET contacted_status=?, work_result=?, last_contact_at=NOW(), arrival_date=COALESCE(?, arrival_date), next_contact_at=COALESCE(?, next_contact_at), result_note=COALESCE(?, result_note) WHERE id=?')->execute([
        $contactedStatus,
        $workResult,
        $arrivalDate,
        $nextContactAt,
        $comment,
        $id,
    ]);
    audit_log($user, 'COMMENT', 'recruitment', $id, $data);
    json_response(['ok' => true], 201);
}

if ($method === 'GET') {
    require_permission('recruitment.view');
    $rows = db()->query('SELECT r.*, u.name AS created_by_name,
        (SELECT COUNT(*) FROM recruitment_comments rc WHERE rc.candidate_id = r.id) AS comments_count,
        (SELECT rc.reaction FROM recruitment_comments rc WHERE rc.candidate_id = r.id ORDER BY rc.created_at DESC, rc.id DESC LIMIT 1) AS last_reaction,
        (SELECT rc.comment FROM recruitment_comments rc WHERE rc.candidate_id = r.id ORDER BY rc.created_at DESC, rc.id DESC LIMIT 1) AS last_comment,
        (SELECT rc.created_at FROM recruitment_comments rc WHERE rc.candidate_id = r.id ORDER BY rc.created_at DESC, rc.id DESC LIMIT 1) AS last_comment_at
      FROM recruitment_candidates r
      LEFT JOIN users u ON u.id = r.created_by
      ORDER BY FIELD(r.status, "new","called","no_answer","interview","hired","rejected","blacklist"), COALESCE(r.arrival_date, r.next_contact_at, r.created_at) DESC LIMIT 500')->fetchAll();
    json_response(['ok' => true, 'data' => $rows]);
}

if ($method === 'POST') {
    $user = require_permission('recruitment.write');
    $data = read_json();
    require_fields($data, ['name']);
    $status = in_array(($data['status'] ?? 'new'), ['new', 'called', 'no_answer', 'interview', 'rejected', 'hired', 'blacklist'], true) ? $data['status'] : 'new';
    $stmt = db()->prepare('INSERT INTO recruitment_candidates (name,phone,email,source,desired_position,status,contacted_status,work_result,last_contact_at,arrival_date,feedback,result_note,next_contact_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $stmt->execute([
        first_string($data, 'name'),
        nullable_string($data, 'phone', 80),
        nullable_string($data, 'email', 255),
        nullable_string($data, 'source', 120),
        nullable_string($data, 'desired_position', 255),
        $status,
        recruitment_contact_status($data),
        recruitment_work_result($data),
        datetime_or_null($data, 'last_contact_at'),
        date_or_null($data, 'arrival_date'),
        nullable_string($data, 'feedback'),
        nullable_string($data, 'result_note'),
        datetime_or_null($data, 'next_contact_at'),
        (int)$user['id'],
    ]);
    $newId = (int)db()->lastInsertId();
    audit_log($user, 'CREATE', 'recruitment', $newId, $data);
    json_response(['ok' => true, 'id' => $newId], 201);
}

if ($method === 'PUT' && $id) {
    $user = require_permission('recruitment.write');
    $data = read_json();
    require_fields($data, ['name']);
    $status = in_array(($data['status'] ?? 'new'), ['new', 'called', 'no_answer', 'interview', 'rejected', 'hired', 'blacklist'], true) ? $data['status'] : 'new';
    $stmt = db()->prepare('UPDATE recruitment_candidates SET name=?, phone=?, email=?, source=?, desired_position=?, status=?, contacted_status=?, work_result=?, last_contact_at=?, arrival_date=?, feedback=?, result_note=?, next_contact_at=? WHERE id=?');
    $stmt->execute([
        first_string($data, 'name'),
        nullable_string($data, 'phone', 80),
        nullable_string($data, 'email', 255),
        nullable_string($data, 'source', 120),
        nullable_string($data, 'desired_position', 255),
        $status,
        recruitment_contact_status($data),
        recruitment_work_result($data),
        datetime_or_null($data, 'last_contact_at'),
        date_or_null($data, 'arrival_date'),
        nullable_string($data, 'feedback'),
        nullable_string($data, 'result_note'),
        datetime_or_null($data, 'next_contact_at'),
        $id,
    ]);
    audit_log($user, 'UPDATE', 'recruitment', $id, $data);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('recruitment.write');
    db()->prepare('DELETE FROM recruitment_candidates WHERE id = ?')->execute([$id]);
    audit_log($user, 'DELETE', 'recruitment', $id);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Recruitment route not found'], 404);
