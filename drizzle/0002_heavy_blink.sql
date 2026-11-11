ALTER TABLE `pass_reservations` MODIFY COLUMN `userId` int;--> statement-breakpoint
ALTER TABLE `pass_reservations` ADD `guestEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `pass_reservations` ADD CONSTRAINT `pass_reservations_guest_email_idx` UNIQUE(`guestEmail`);