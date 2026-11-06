-- CreateTable
CREATE TABLE `app_users` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `email` VARCHAR(254) NOT NULL,
    `display_name` VARCHAR(100) NOT NULL,
    `role` VARCHAR(32) NOT NULL,
    `password_salt` CHAR(32) NOT NULL,
    `password_hash` CHAR(128) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `app_users_tenant_email_uidx`(`tenant_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_sessions` (
    `token_hash` CHAR(64) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `user_id` CHAR(36) NOT NULL,
    `csrf_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `app_sessions_user_expiry_idx`(`user_id`, `expires_at`),
    PRIMARY KEY (`token_hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_articles` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `title` VARCHAR(255) NOT NULL,
    `category` VARCHAR(100) NOT NULL,
    `system` VARCHAR(100) NOT NULL,
    `problem` TEXT NOT NULL,
    `solution` TEXT NOT NULL,
    `steps` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `requests` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `description` TEXT NOT NULL,
    `decision` JSON NOT NULL,
    `priority` VARCHAR(64) NOT NULL,
    `queue` VARCHAR(100) NOT NULL,
    `confidence` DECIMAL(8, 5) NOT NULL,
    `article_id` VARCHAR(191) NULL,
    `article_snapshot` JSON NULL,
    `corrected_decision` JSON NULL,
    `corrected_at` DATETIME(3) NULL,
    `correction_reason` TEXT NULL,
    `triage_status` VARCHAR(64) NOT NULL DEFAULT 'READY',
    `locality` VARCHAR(255) NOT NULL DEFAULT 'Nao informada',
    `synthetic` BOOLEAN NOT NULL DEFAULT false,
    `created_by` CHAR(36) NULL,
    `status` VARCHAR(64) NOT NULL DEFAULT 'ANALYZED',
    `provider` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `requests_created_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `decisions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` CHAR(36) NULL,
    `request_id` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `provider` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_protocol_seq` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tickets` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `protocol` VARCHAR(191) NOT NULL,
    `request_id` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `category` VARCHAR(100) NOT NULL,
    `system` VARCHAR(100) NOT NULL,
    `impact` VARCHAR(64) NOT NULL,
    `urgency` VARCHAR(64) NOT NULL,
    `priority` VARCHAR(64) NOT NULL,
    `status` VARCHAR(64) NOT NULL DEFAULT 'OPEN',
    `assigned_queue` VARCHAR(100) NOT NULL,
    `confidence` DECIMAL(8, 5) NOT NULL,
    `incident_code` VARCHAR(191) NULL,
    `synthetic` BOOLEAN NOT NULL DEFAULT false,
    `first_assigned_at` DATETIME(3) NULL,
    `first_resolved_at` DATETIME(3) NULL,
    `status_synced_at` DATETIME(3) NULL,
    `glpi_category_id` INTEGER NULL,
    `queue_routing` VARCHAR(64) NOT NULL DEFAULT 'SUGGESTED_ONLY',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tickets_system_created_idx`(`system`, `created_at`),
    UNIQUE INDEX `tickets_tenant_protocol_uidx`(`tenant_id`, `protocol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incidents` (
    `code` VARCHAR(191) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `title` VARCHAR(255) NOT NULL,
    `system` VARCHAR(100) NOT NULL,
    `category` VARCHAR(100) NOT NULL,
    `severity` VARCHAR(64) NOT NULL,
    `status` VARCHAR(64) NOT NULL DEFAULT 'INVESTIGATING',
    `detected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incident_tickets` (
    `tenant_id` CHAR(36) NULL,
    `incident_code` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`incident_code`, `ticket_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` CHAR(36) NULL,
    `type` VARCHAR(100) NOT NULL,
    `request_id` VARCHAR(191) NOT NULL,
    `knowledge_article_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_status_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` CHAR(36) NULL,
    `ticket_id` VARCHAR(191) NOT NULL,
    `previous_status` VARCHAR(64) NULL,
    `status` VARCHAR(64) NOT NULL,
    `observed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `request_feedback` (
    `request_id` VARCHAR(191) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `rating` SMALLINT NOT NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`request_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evaluation_cases` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` CHAR(36) NULL,
    `source_request_id` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `expected` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `evaluation_cases_source_request_id_key`(`source_request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_settings` (
    `tenant_id` CHAR(36) NOT NULL,
    `setting_key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`tenant_id`, `setting_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_localities` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` CHAR(36) NULL,
    `name` VARCHAR(255) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `app_sessions` ADD CONSTRAINT `app_sessions_user_fk` FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requests` ADD CONSTRAINT `requests_article_fk` FOREIGN KEY (`article_id`) REFERENCES `knowledge_articles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requests` ADD CONSTRAINT `requests_user_fk` FOREIGN KEY (`created_by`) REFERENCES `app_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `decisions` ADD CONSTRAINT `decisions_request_fk` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_request_fk` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incident_tickets` ADD CONSTRAINT `incident_tickets_incident_fk` FOREIGN KEY (`incident_code`) REFERENCES `incidents`(`code`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incident_tickets` ADD CONSTRAINT `incident_tickets_ticket_fk` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_events` ADD CONSTRAINT `service_events_request_fk` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_status_history` ADD CONSTRAINT `ticket_history_ticket_fk` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_feedback` ADD CONSTRAINT `feedback_request_fk` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluation_cases` ADD CONSTRAINT `evaluation_request_fk` FOREIGN KEY (`source_request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ticket_protocol_seq` AUTO_INCREMENT = 106;
