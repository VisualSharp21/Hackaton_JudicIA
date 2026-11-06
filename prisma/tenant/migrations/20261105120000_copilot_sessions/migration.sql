-- Copilot Nível 1: sessões de atendimento conversacional (template hermes-memory/sessoes/template-sessao.md)
CREATE TABLE `copilot_sessions` (
    `id` VARCHAR(40) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `request_id` VARCHAR(191) NULL,
    `machine_id` VARCHAR(40) NOT NULL,
    `machine_detection` VARCHAR(32) NOT NULL DEFAULT 'seletor',
    `status` VARCHAR(40) NOT NULL DEFAULT 'EM_ANDAMENTO',
    `engine` VARCHAR(191) NOT NULL DEFAULT 'regras',
    `state` JSON NOT NULL,
    `ticket_id` VARCHAR(191) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `copilot_sessions_user_idx`(`created_by`, `created_at`),
    INDEX `copilot_sessions_request_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `copilot_sessions` ADD CONSTRAINT `copilot_sessions_request_fk` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `copilot_sessions` ADD CONSTRAINT `copilot_sessions_user_fk` FOREIGN KEY (`created_by`) REFERENCES `app_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
