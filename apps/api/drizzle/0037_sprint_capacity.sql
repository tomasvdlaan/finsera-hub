CREATE TABLE "scrum"."sprint_capacity" (
	"sprint_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_capacity_sprint_id_user_id_pk" PRIMARY KEY("sprint_id","user_id"),
	CONSTRAINT "sprint_capacity_sane" CHECK ("scrum"."sprint_capacity"."minutes" > 0 AND "scrum"."sprint_capacity"."minutes" <= 100000)
);
--> statement-breakpoint
ALTER TABLE "scrum"."sprint_capacity" ADD CONSTRAINT "sprint_capacity_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "scrum"."sprints"("id") ON DELETE cascade ON UPDATE no action;