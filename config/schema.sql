-- SpinSpring Express full schema (MySQL / MariaDB, utf8mb4)
CREATE DATABASE IF NOT EXISTS `buxbtreu_spinspringwebappdb` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `buxbtreu_spinspringwebappdb`;

CREATE TABLE IF NOT EXISTS `ss_users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(190) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(190) NOT NULL,
  `business_name` VARCHAR(190) DEFAULT NULL,
  `phone` VARCHAR(50) DEFAULT NULL,
  `role` VARCHAR(20) NOT NULL DEFAULT 'owner',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `ss_devices` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `device_id` VARCHAR(80) NOT NULL UNIQUE,
  `device_name` VARCHAR(190) NOT NULL,
  `device_type` VARCHAR(60) NOT NULL DEFAULT 'washing_machine',
  `api_key` VARCHAR(190) NOT NULL,
  `owner_id` INT NOT NULL,
  `location_area` VARCHAR(190) DEFAULT NULL,
  `price_per_cycle` DECIMAL(10,2) NOT NULL DEFAULT 300.00,
  `price_per_kg` DECIMAL(10,2) NOT NULL DEFAULT 50.00,
  `max_capacity_kg` DECIMAL(6,2) NOT NULL DEFAULT 20.00,
  `min_capacity_kg` DECIMAL(6,2) NOT NULL DEFAULT 1.00,
  `status` VARCHAR(30) NOT NULL DEFAULT 'offline',
  `current_cycle` VARCHAR(80) DEFAULT NULL,
  `cycle_progress` INT NOT NULL DEFAULT 0,
  `cycles_completed` INT NOT NULL DEFAULT 0,
  `today_cycles` INT NOT NULL DEFAULT 0,
  `today_revenue` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_revenue` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `last_sync` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (`owner_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `ss_attendants` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `owner_id` INT NOT NULL,
  `full_name` VARCHAR(190) NOT NULL,
  `email` VARCHAR(190) NOT NULL UNIQUE,
  `phone` VARCHAR(50) DEFAULT NULL,
  `pin_code` VARCHAR(20) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (`owner_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `ss_customers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `owner_id` INT NOT NULL,
  `customer_unique_id` VARCHAR(40) NOT NULL UNIQUE,
  `full_name` VARCHAR(190) NOT NULL,
  `phone` VARCHAR(50) DEFAULT NULL,
  `email` VARCHAR(190) DEFAULT NULL,
  `total_cycles` INT NOT NULL DEFAULT 0,
  `total_spent` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `loyalty_points` INT NOT NULL DEFAULT 0,
  `tier` VARCHAR(20) NOT NULL DEFAULT 'bronze',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (`owner_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `ss_orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_number` VARCHAR(40) NOT NULL UNIQUE,
  `device_id` VARCHAR(80) NOT NULL,
  `user_id` INT NOT NULL COMMENT 'owner id',
  `customer_name` VARCHAR(80) NOT NULL DEFAULT 'walk-in' COMMENT 'customer_unique_id or walk-in',
  `service_type` VARCHAR(40) NOT NULL DEFAULT 'wash',
  `cycle_type` VARCHAR(40) NOT NULL DEFAULT 'normal',
  `weight_kg` DECIMAL(6,2) DEFAULT NULL,
  `price_per_kg` DECIMAL(10,2) DEFAULT NULL,
  `total_weight_price` DECIMAL(10,2) DEFAULT NULL,
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `payment_status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `order_status` VARCHAR(20) NOT NULL DEFAULT 'queued',
  `start_time` DATETIME DEFAULT NULL,
  `end_time` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (`device_id`),
  INDEX (`user_id`),
  INDEX (`customer_name`),
  INDEX (`order_status`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `ss_commands` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `device_id` VARCHAR(80) NOT NULL,
  `command_type` VARCHAR(60) NOT NULL,
  `command_value` VARCHAR(190) DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (`device_id`),
  INDEX (`status`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `ss_mpesa_config` (
  `owner_id` INT PRIMARY KEY,
  `business_shortcode` VARCHAR(30) DEFAULT NULL,
  `account_type` VARCHAR(20) DEFAULT 'till',
  `consumer_key` VARCHAR(190) DEFAULT NULL,
  `consumer_secret` VARCHAR(190) DEFAULT NULL,
  `passkey` VARCHAR(190) DEFAULT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Persistent express-session storage (express-mysql-session).
-- Same shape the library auto-creates with createDatabaseTable: true.
-- Included here so DB users WITHOUT CREATE privilege can import it manually.
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` VARCHAR(128) NOT NULL,
  `expires` INT(11) UNSIGNED NOT NULL,
  `data` MEDIUMTEXT DEFAULT NULL,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB;

-- Visible error log (written by server.js error handler, best-effort).
CREATE TABLE IF NOT EXISTS `ss_error_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `ref` VARCHAR(20) DEFAULT NULL,
  `method` VARCHAR(10) DEFAULT NULL,
  `url` VARCHAR(500) DEFAULT NULL,
  `status` INT DEFAULT NULL,
  `message` TEXT DEFAULT NULL,
  `stack` MEDIUMTEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (`created_at`)
) ENGINE=InnoDB;
