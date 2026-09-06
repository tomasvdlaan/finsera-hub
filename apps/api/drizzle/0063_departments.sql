CREATE TABLE "core"."departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"is_standard" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "core"."user_departments" (
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "user_departments_user_id_department_id_pk" PRIMARY KEY("user_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "core"."user_departments" ADD CONSTRAINT "user_departments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."user_departments" ADD CONSTRAINT "user_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."user_departments" ADD CONSTRAINT "user_departments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_departments_department_idx" ON "core"."user_departments" USING btree ("department_id");