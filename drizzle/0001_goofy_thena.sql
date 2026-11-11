CREATE TABLE `pass_reservations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('reserved','checked_in') NOT NULL DEFAULT 'reserved',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pass_reservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `pass_reservations_user_idx` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reservationId` int NOT NULL,
	`ticketId` varchar(40) NOT NULL,
	`attendeeName` varchar(160) NOT NULL,
	`attendeeEmail` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `tickets_ticketId_unique` UNIQUE(`ticketId`),
	CONSTRAINT `tickets_reservation_idx` UNIQUE(`reservationId`)
);
--> statement-breakpoint
CREATE TABLE `waitlist_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`email` varchar(320) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `waitlist_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `waitlist_entries_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `name` varchar(160);