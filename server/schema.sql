-- Coal & Ash tables. MySQL 8.0.13 or newer.
-- Text defaults use DEFAULT ('') because MySQL rejects DEFAULT '' on TEXT.
-- Change this file when the schema changes, then run npm run db:reset on a database you can rebuild.

CREATE TABLE `User` (
  `id` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `passwordHash` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL,
  `personKey` VARCHAR(191) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `User_email_key` (`email`),
  UNIQUE KEY `User_personKey_key` (`personKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `CalendarSettings` (
  `id` VARCHAR(191) NOT NULL,
  `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Kolkata',
  `workStart` VARCHAR(191) NOT NULL DEFAULT '09:00',
  `workEnd` VARCHAR(191) NOT NULL DEFAULT '18:00',
  `workingDays` VARCHAR(191) NOT NULL DEFAULT '1,2,3,4,5',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Holiday` (
  `id` VARCHAR(191) NOT NULL,
  `date` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Holiday_date_key` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `SlaPolicy` (
  `id` VARCHAR(191) NOT NULL,
  `stage` VARCHAR(191) NOT NULL,
  `durationValue` INTEGER NOT NULL,
  `durationUnit` VARCHAR(191) NOT NULL,
  `targetValue` INTEGER NULL,
  `targetUnit` VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `SlaPolicy_stage_key` (`stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `EscalationRecipient` (
  `id` VARCHAR(191) NOT NULL,
  `level` INTEGER NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `AppSettings` (
  `id` VARCHAR(191) NOT NULL,
  `bgRequiresBoth` BOOLEAN NOT NULL DEFAULT false,
  `revisionResetsSla` BOOLEAN NOT NULL DEFAULT true,
  `bidReminderHours` VARCHAR(191) NOT NULL DEFAULT '72,24,4',
  `level2AfterMinutes` INTEGER NOT NULL DEFAULT 240,
  `recordPrefix` VARCHAR(191) NOT NULL DEFAULT 'CA',
  `nextSequence` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `EmailTemplate` (
  `id` VARCHAR(191) NOT NULL,
  `event` VARCHAR(191) NOT NULL,
  `subject` TEXT NOT NULL,
  `body` LONGTEXT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `EmailTemplate_event_key` (`event`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Tender` (
  `id` VARCHAR(191) NOT NULL,
  `recordId` VARCHAR(191) NOT NULL,
  `projectName` TEXT NOT NULL DEFAULT (''),
  `tenderRef` TEXT NOT NULL DEFAULT (''),
  `externalTenderId` TEXT NOT NULL DEFAULT (''),
  `clientName` TEXT NOT NULL DEFAULT (''),
  `portalName` TEXT NOT NULL DEFAULT (''),
  `location` TEXT NOT NULL DEFAULT (''),
  `bidSubmissionEnd` DATETIME(3) NULL,
  `bidOpeningAt` DATETIME(3) NULL,
  `estimatedValue` DOUBLE NULL,
  `finalCostingValue` DOUBLE NULL,
  `emdExposure` DOUBLE NULL,
  `emdType` VARCHAR(191) NOT NULL DEFAULT 'UNCLEAR',
  `overallStatus` VARCHAR(191) NOT NULL,
  `relevanceStatus` VARCHAR(191) NOT NULL DEFAULT 'NOT_STARTED',
  `costingStatus` VARCHAR(191) NOT NULL DEFAULT 'NOT_STARTED',
  `emdStatus` VARCHAR(191) NOT NULL DEFAULT 'NOT_STARTED',
  `bidStatus` VARCHAR(191) NOT NULL DEFAULT 'NOT_YET_SUBMITTED',
  `approvalStatus` VARCHAR(191) NOT NULL DEFAULT 'NOT_STARTED',
  `source` VARCHAR(191) NOT NULL DEFAULT 'MANUAL',
  `ocrStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `duplicateOfId` VARCHAR(191) NULL,
  `duplicateWarning` TEXT NOT NULL DEFAULT (''),
  `relevanceOverdue` BOOLEAN NOT NULL DEFAULT false,
  `deadlineMissed` BOOLEAN NOT NULL DEFAULT false,
  `closureReason` TEXT NOT NULL DEFAULT (''),
  `outcome` VARCHAR(191) NOT NULL DEFAULT '',
  `outcomeNotes` TEXT NOT NULL DEFAULT (''),
  `createdById` VARCHAR(191) NOT NULL,
  `submitterId` VARCHAR(191) NULL,
  `closedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Tender_recordId_key` (`recordId`),
  KEY `Tender_overallStatus_idx` (`overallStatus`),
  KEY `Tender_bidSubmissionEnd_idx` (`bidSubmissionEnd`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `TenderDocument` (
  `id` VARCHAR(191) NOT NULL,
  `tenderId` VARCHAR(191) NOT NULL,
  `fileName` TEXT NOT NULL,
  `storedPath` TEXT NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `sizeBytes` INTEGER NOT NULL,
  `sha256` VARCHAR(191) NOT NULL DEFAULT '',
  `docType` VARCHAR(191) NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `uploadedById` VARCHAR(191) NOT NULL,
  `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `textExtract` LONGTEXT NOT NULL DEFAULT (''),
  `ocrJson` LONGTEXT NOT NULL DEFAULT (''),
  `pageCount` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `TenderDocument_tenderId_idx` (`tenderId`),
  KEY `TenderDocument_sha256_idx` (`sha256`),
  CONSTRAINT `TenderDocument_tenderId_fkey` FOREIGN KEY (`tenderId`) REFERENCES `Tender`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `TenderField` (
  `id` VARCHAR(191) NOT NULL,
  `tenderId` VARCHAR(191) NOT NULL,
  `fieldNo` INTEGER NOT NULL,
  `fieldKey` VARCHAR(191) NOT NULL,
  `label` TEXT NOT NULL,
  `extractedValue` TEXT NOT NULL DEFAULT (''),
  `correctedValue` TEXT NOT NULL DEFAULT (''),
  `correctedAt` DATETIME(3) NULL,
  `sourceDocumentId` VARCHAR(191) NOT NULL DEFAULT '',
  `sourcePage` VARCHAR(191) NOT NULL DEFAULT '',
  `confidence` DOUBLE NULL,
  `validationStatus` VARCHAR(191) NOT NULL DEFAULT 'MISSING',
  `conflictNote` TEXT NOT NULL DEFAULT (''),
  `correctedById` VARCHAR(191) NOT NULL DEFAULT '',
  `critical` BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (`id`),
  UNIQUE KEY `TenderField_tenderId_fieldKey_key` (`tenderId`, `fieldKey`),
  CONSTRAINT `TenderField_tenderId_fkey` FOREIGN KEY (`tenderId`) REFERENCES `Tender`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `WorkflowTask` (
  `id` VARCHAR(191) NOT NULL,
  `tenderId` VARCHAR(191) NOT NULL,
  `branch` VARCHAR(191) NOT NULL,
  `stage` VARCHAR(191) NOT NULL,
  `title` TEXT NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `assigneeIds` TEXT NOT NULL,
  `dueAt` DATETIME(3) NULL,
  `slaMinutes` INTEGER NOT NULL DEFAULT 0,
  `baseAt` DATETIME(3) NOT NULL,
  `reminder50Sent` BOOLEAN NOT NULL DEFAULT false,
  `reminder75Sent` BOOLEAN NOT NULL DEFAULT false,
  `breachSent` BOOLEAN NOT NULL DEFAULT false,
  `breachLevel2Sent` BOOLEAN NOT NULL DEFAULT false,
  `wasOverdue` BOOLEAN NOT NULL DEFAULT false,
  `decision` TEXT NOT NULL DEFAULT (''),
  `comments` TEXT NOT NULL DEFAULT (''),
  `completedById` VARCHAR(191) NOT NULL DEFAULT '',
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `WorkflowTask_tenderId_idx` (`tenderId`),
  KEY `WorkflowTask_status_idx` (`status`),
  CONSTRAINT `WorkflowTask_tenderId_fkey` FOREIGN KEY (`tenderId`) REFERENCES `Tender`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `TaskAction` (
  `id` VARCHAR(191) NOT NULL,
  `taskId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `action` VARCHAR(191) NOT NULL,
  `comments` TEXT NOT NULL DEFAULT (''),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `TaskAction_taskId_idx` (`taskId`),
  CONSTRAINT `TaskAction_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `WorkflowTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `CostingRecord` (
  `id` VARCHAR(191) NOT NULL,
  `tenderId` VARCHAR(191) NOT NULL,
  `version` INTEGER NOT NULL,
  `stage` VARCHAR(191) NOT NULL,
  `assumptions` TEXT NOT NULL DEFAULT (''),
  `amount` DOUBLE NULL,
  `documentId` VARCHAR(191) NOT NULL DEFAULT '',
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `CostingRecord_tenderId_idx` (`tenderId`),
  CONSTRAINT `CostingRecord_tenderId_fkey` FOREIGN KEY (`tenderId`) REFERENCES `Tender`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `EmdRecord` (
  `id` VARCHAR(191) NOT NULL,
  `tenderId` VARCHAR(191) NOT NULL,
  `instrumentType` VARCHAR(191) NOT NULL,
  `amount` TEXT NOT NULL DEFAULT (''),
  `beneficiary` TEXT NOT NULL DEFAULT (''),
  `referenceNumber` TEXT NOT NULL DEFAULT (''),
  `preparationStatus` VARCHAR(191) NOT NULL DEFAULT 'NOT_STARTED',
  `exemptionBasis` TEXT NOT NULL DEFAULT (''),
  `documentId` VARCHAR(191) NOT NULL DEFAULT '',
  `verifiedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `submittedToAuthority` BOOLEAN NOT NULL DEFAULT false,
  `authorityNote` TEXT NOT NULL DEFAULT (''),
  `notes` TEXT NOT NULL DEFAULT (''),
  PRIMARY KEY (`id`),
  UNIQUE KEY `EmdRecord_tenderId_key` (`tenderId`),
  CONSTRAINT `EmdRecord_tenderId_fkey` FOREIGN KEY (`tenderId`) REFERENCES `Tender`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ApprovalRecord` (
  `id` VARCHAR(191) NOT NULL,
  `tenderId` VARCHAR(191) NOT NULL,
  `taskId` VARCHAR(191) NOT NULL DEFAULT '',
  `stage` VARCHAR(191) NOT NULL,
  `decision` VARCHAR(191) NOT NULL,
  `approverId` VARCHAR(191) NOT NULL,
  `comments` TEXT NOT NULL DEFAULT (''),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ApprovalRecord_tenderId_idx` (`tenderId`),
  CONSTRAINT `ApprovalRecord_tenderId_fkey` FOREIGN KEY (`tenderId`) REFERENCES `Tender`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `BidSubmission` (
  `id` VARCHAR(191) NOT NULL,
  `tenderId` VARCHAR(191) NOT NULL,
  `submitterId` VARCHAR(191) NOT NULL DEFAULT '',
  `status` VARCHAR(191) NOT NULL,
  `submittedAt` DATETIME(3) NULL,
  `referenceNumber` TEXT NOT NULL DEFAULT (''),
  `evidenceDocumentId` VARCHAR(191) NOT NULL DEFAULT '',
  `exceptionReason` TEXT NOT NULL DEFAULT (''),
  `exceptionAuthorizedById` VARCHAR(191) NOT NULL DEFAULT '',
  `notes` TEXT NOT NULL DEFAULT (''),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `BidSubmission_tenderId_key` (`tenderId`),
  CONSTRAINT `BidSubmission_tenderId_fkey` FOREIGN KEY (`tenderId`) REFERENCES `Tender`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `NotificationLog` (
  `id` VARCHAR(191) NOT NULL,
  `tenderId` VARCHAR(191) NULL,
  `taskId` VARCHAR(191) NOT NULL DEFAULT '',
  `eventType` VARCHAR(191) NOT NULL,
  `recipientEmail` VARCHAR(191) NOT NULL,
  `recipientName` TEXT NOT NULL DEFAULT (''),
  `subject` TEXT NOT NULL,
  `body` LONGTEXT NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `NotificationLog_tenderId_idx` (`tenderId`),
  KEY `NotificationLog_recipientEmail_idx` (`recipientEmail`),
  CONSTRAINT `NotificationLog_tenderId_fkey` FOREIGN KEY (`tenderId`) REFERENCES `Tender`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `AuditLog` (
  `id` VARCHAR(191) NOT NULL,
  `tenderId` VARCHAR(191) NULL,
  `actorId` VARCHAR(191) NOT NULL DEFAULT '',
  `actorName` TEXT NOT NULL DEFAULT (''),
  `action` TEXT NOT NULL,
  `entity` VARCHAR(191) NOT NULL,
  `detail` TEXT NOT NULL DEFAULT (''),
  `before` LONGTEXT NOT NULL DEFAULT (''),
  `after` LONGTEXT NOT NULL DEFAULT (''),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `AuditLog_tenderId_idx` (`tenderId`),
  CONSTRAINT `AuditLog_tenderId_fkey` FOREIGN KEY (`tenderId`) REFERENCES `Tender`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Portal` (
  `id` VARCHAR(191) NOT NULL,
  `name` TEXT NOT NULL,
  `url` TEXT NOT NULL,
  `category` TEXT NOT NULL DEFAULT (''),
  `keywords` TEXT NOT NULL DEFAULT (''),
  `frequencyHours` INTEGER NOT NULL DEFAULT 24,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `accessMethod` VARCHAR(191) NOT NULL DEFAULT 'UNVALIDATED',
  `lastScanAt` DATETIME(3) NULL,
  `lastStatus` VARCHAR(191) NOT NULL DEFAULT 'NOT_SCANNED',
  `lastError` TEXT NOT NULL DEFAULT (''),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `CrawlerRun` (
  `id` VARCHAR(191) NOT NULL,
  `portalId` VARCHAR(191) NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `status` VARCHAR(191) NOT NULL,
  `discovered` INTEGER NOT NULL DEFAULT 0,
  `errorSummary` TEXT NOT NULL DEFAULT (''),
  PRIMARY KEY (`id`),
  KEY `CrawlerRun_portalId_idx` (`portalId`),
  CONSTRAINT `CrawlerRun_portalId_fkey` FOREIGN KEY (`portalId`) REFERENCES `Portal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `CrawlerException` (
  `id` VARCHAR(191) NOT NULL,
  `runId` VARCHAR(191) NULL,
  `portalId` VARCHAR(191) NOT NULL DEFAULT '',
  `kind` TEXT NOT NULL,
  `detail` TEXT NOT NULL,
  `tenderHint` TEXT NOT NULL DEFAULT (''),
  `resolved` BOOLEAN NOT NULL DEFAULT false,
  `followUpTaskId` VARCHAR(191) NOT NULL DEFAULT '',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `CrawlerException_runId_idx` (`runId`),
  CONSTRAINT `CrawlerException_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `CrawlerRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
