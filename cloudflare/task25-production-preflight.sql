/* READ ONLY: schema/ledger inspection before applying 0024.
   Outputs schema metadata, never user/session/business record contents. */
SELECT name, type, sql FROM sqlite_master
WHERE name LIKE 'task25_%' OR name = 'wyj_d1_migrations'
ORDER BY type, name;
PRAGMA table_info(task12_users);
PRAGMA table_info(task25_metadata);
PRAGMA table_info(task25_feature_flags);
PRAGMA table_info(task25_user_flag_overrides);
PRAGMA table_info(task25_release_preferences);
PRAGMA table_info(task25_flag_audit);
PRAGMA foreign_key_list(task25_feature_flags);
PRAGMA foreign_key_list(task25_user_flag_overrides);
PRAGMA foreign_key_list(task25_release_preferences);
