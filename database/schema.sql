-- Reference schema (SQLite). The app creates these tables automatically on first start;
-- this file is generated from backend/database/models.py and is for documentation only.

CREATE TABLE admins (
	id INTEGER NOT NULL, 
	username VARCHAR(50) NOT NULL, 
	email VARCHAR(100) NOT NULL, 
	password_hash VARCHAR(255) NOT NULL, 
	is_active BOOLEAN, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	PRIMARY KEY (id)
);

CREATE INDEX ix_admins_id ON admins (id);
CREATE UNIQUE INDEX ix_admins_email ON admins (email);
CREATE UNIQUE INDEX ix_admins_username ON admins (username);

CREATE TABLE attendance_sessions (
	id INTEGER NOT NULL, 
	title VARCHAR(150) NOT NULL, 
	department VARCHAR(100), 
	year INTEGER, 
	section VARCHAR(10), 
	start_time DATETIME NOT NULL, 
	end_time DATETIME NOT NULL, 
	grace_minutes INTEGER NOT NULL, 
	closed_at DATETIME, 
	created_by VARCHAR(50), 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	PRIMARY KEY (id)
);

CREATE INDEX ix_attendance_sessions_id ON attendance_sessions (id);

CREATE TABLE students (
	id INTEGER NOT NULL, 
	student_id VARCHAR(50) NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	department VARCHAR(100) NOT NULL, 
	year INTEGER NOT NULL, 
	section VARCHAR(10) NOT NULL, 
	email VARCHAR(100), 
	phone VARCHAR(20), 
	photo_path VARCHAR(255), 
	portal_password_hash VARCHAR(255), 
	is_active BOOLEAN, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	updated_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (email)
);

CREATE UNIQUE INDEX ix_students_student_id ON students (student_id);
CREATE INDEX ix_students_id ON students (id);

CREATE TABLE system_settings (
	id INTEGER NOT NULL, 
	"key" VARCHAR(100) NOT NULL, 
	value TEXT NOT NULL, 
	description TEXT, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	PRIMARY KEY (id), 
	UNIQUE ("key")
);

CREATE INDEX ix_system_settings_id ON system_settings (id);

CREATE TABLE attendance (
	id INTEGER NOT NULL, 
	student_id INTEGER NOT NULL, 
	session_id INTEGER, 
	date DATE NOT NULL, 
	time_in TIME NOT NULL, 
	face_score FLOAT, 
	palm_score FLOAT, 
	fingerprint_score FLOAT, 
	fusion_score FLOAT, 
	verification_method VARCHAR(50) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	notes TEXT, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	PRIMARY KEY (id), 
	FOREIGN KEY(student_id) REFERENCES students (id), 
	FOREIGN KEY(session_id) REFERENCES attendance_sessions (id)
);

CREATE INDEX ix_attendance_id ON attendance (id);
CREATE INDEX ix_attendance_session_id ON attendance (session_id);

CREATE TABLE face_templates (
	id INTEGER NOT NULL, 
	student_id INTEGER NOT NULL, 
	embedding TEXT NOT NULL, 
	quality_score FLOAT, 
	source VARCHAR(20) DEFAULT 'enroll' NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	updated_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(student_id) REFERENCES students (id)
);

CREATE INDEX ix_face_templates_id ON face_templates (id);

CREATE TABLE fingerprint_templates (
	id INTEGER NOT NULL, 
	student_id INTEGER NOT NULL, 
	template TEXT NOT NULL, 
	quality_score FLOAT, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	updated_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(student_id) REFERENCES students (id)
);

CREATE INDEX ix_fingerprint_templates_id ON fingerprint_templates (id);

CREATE TABLE notifications (
	id INTEGER NOT NULL, 
	student_id INTEGER, 
	channel VARCHAR(10) NOT NULL, 
	kind VARCHAR(30) NOT NULL, 
	recipient VARCHAR(150), 
	subject VARCHAR(200), 
	body TEXT NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	error TEXT, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	PRIMARY KEY (id), 
	FOREIGN KEY(student_id) REFERENCES students (id)
);

CREATE INDEX ix_notifications_id ON notifications (id);

CREATE TABLE palm_templates (
	id INTEGER NOT NULL, 
	student_id INTEGER NOT NULL, 
	hand_side VARCHAR(10) NOT NULL, 
	embedding TEXT NOT NULL, 
	quality_score FLOAT, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	updated_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(student_id) REFERENCES students (id)
);

CREATE INDEX ix_palm_templates_id ON palm_templates (id);
