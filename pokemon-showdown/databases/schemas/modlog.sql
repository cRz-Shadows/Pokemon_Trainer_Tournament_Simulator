CREATE TABLE modlog (
    modlog_id INTEGER NOT NULL PRIMARY KEY,
    -- UNIX timestamp
    timestamp INTEGER NOT NULL,
    roomid TEXT NOT NULL,
    is_global TINYINT(1) NOT NULL,
    action TEXT NOT NULL,
    visual_roomid TEXT NOT NULL,
    note TEXT NOT NULL,
    action_taker_userid TEXT,
    userid TEXT,
    autoconfirmed_userid TEXT,
    ip TEXT
);

CREATE TABLE alts (
    modlog_id INTEGER NOT NULL,
    userid TEXT NOT NULL,
    PRIMARY KEY (modlog_id, userid),
    FOREIGN KEY (modlog_id) REFERENCES modlog(modlog_id)
) WITHOUT ROWID;

CREATE TABLE db_info (
    key TEXT NOT NULL,
    value TEXT NOT NULL
);

INSERT INTO db_info VALUES ('version', '2');

CREATE INDEX global_index ON modlog(is_global, timestamp);
CREATE INDEX global_action_index ON modlog(is_global, action, timestamp);
CREATE INDEX global_userid_index_1 ON modlog(is_global, userid, timestamp);
CREATE INDEX global_userid_index_2 ON modlog(is_global, autoconfirmed_userid, timestamp);
CREATE INDEX global_ip_index ON modlog(is_global, ip, timestamp);
CREATE INDEX global_note_index ON modlog(is_global, note, timestamp);
CREATE INDEX global_action_taker_index ON modlog(is_global, action_taker_userid, timestamp);

CREATE INDEX all_room_index ON modlog(timestamp);
CREATE INDEX all_room_action_index ON modlog(action, timestamp);
CREATE INDEX all_room_userid_index_1 ON modlog(userid, timestamp);
CREATE INDEX all_room_userid_index_2 ON modlog(autoconfirmed_userid, timestamp);
CREATE INDEX all_room_ip_index ON modlog(ip, timestamp);
CREATE INDEX all_room_note_index ON modlog(note, timestamp);
CREATE INDEX all_room_action_taker_index ON modlog(action_taker_userid, timestamp);

CREATE INDEX room_index ON modlog(roomid, timestamp);
CREATE INDEX action_index ON modlog(roomid, action, timestamp);
CREATE INDEX userid_index_1 ON modlog(roomid, userid, timestamp);
CREATE INDEX userid_index_2 ON modlog(roomid, autoconfirmed_userid, timestamp);
CREATE INDEX ip_index ON modlog(roomid, ip, timestamp);
CREATE INDEX note_index ON modlog(roomid, note, timestamp);
CREATE INDEX action_taker_index ON modlog(roomid, action_taker_userid, timestamp);

PRAGMA journal_mode=WAL;
