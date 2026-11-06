CREATE TABLE prevention_mutex (id INT NOT NULL PRIMARY KEY);
INSERT INTO prevention_mutex(id) VALUES(1);
CREATE TABLE prevention_records (
  kind VARCHAR(32) NOT NULL,
  id VARCHAR(191) NOT NULL,
  hearing_id VARCHAR(191) NULL,
  status VARCHAR(64) NULL,
  due_at BIGINT NULL,
  payload JSON NOT NULL,
  PRIMARY KEY(kind,id),
  INDEX prevention_due(kind,status,due_at),
  INDEX prevention_hearing(hearing_id)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE prevention_audit (
  id CHAR(36) NOT NULL PRIMARY KEY,
  hearing_id VARCHAR(191) NOT NULL,
  created_at BIGINT NOT NULL,
  payload JSON NOT NULL,
  INDEX prevention_audit_hearing(hearing_id,created_at)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
