<?php
declare(strict_types=1);

require_permission('logs.view');
$limit = max(1, min(300, (int)($_GET['limit'] ?? 150)));
$stmt = db()->prepare('SELECT id,user_name,action,entity,entity_id,ip_address,created_at,old_data,new_data FROM audit_logs ORDER BY created_at DESC LIMIT ?');
$stmt->bindValue(1, $limit, PDO::PARAM_INT);
$stmt->execute();
json_response(['ok' => true, 'data' => $stmt->fetchAll()]);
