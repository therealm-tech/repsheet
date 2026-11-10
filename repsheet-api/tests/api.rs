use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use http_body_util::BodyExt;
use repsheet_api::{AppState, app, ensure_super_admin};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

const ADMIN_EMAIL: &str = "admin@example.com";
const ADMIN_PASSWORD: &str = "admin password";

struct TestApp {
    router: Router,
    pool: PgPool,
}

impl TestApp {
    fn new(pool: PgPool) -> Self {
        Self {
            router: app(AppState::new(pool.clone(), chrono::Duration::days(1))),
            pool,
        }
    }

    async fn log_in(&self, email: &str, password: &str) -> (StatusCode, Value) {
        self.send(
            Method::POST,
            "/v1/tokens",
            None,
            Some(json!({ "email": email, "password": password })),
        )
        .await
    }

    /// Runs the start-up upsert and returns a token for the super admin.
    async fn super_admin(&self) -> String {
        ensure_super_admin(&self.pool, ADMIN_EMAIL, ADMIN_PASSWORD.to_owned())
            .await
            .unwrap();
        let (status, body) = self.log_in(ADMIN_EMAIL, ADMIN_PASSWORD).await;
        assert_eq!(status, StatusCode::CREATED);
        body["token"].as_str().unwrap().to_owned()
    }

    async fn user_id(&self, token: &str) -> String {
        let (_, me) = self.get("/v1/users/me", token).await;
        me["id"].as_str().unwrap().to_owned()
    }

    async fn send(
        &self,
        method: Method,
        uri: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder().method(method).uri(uri);
        if let Some(token) = token {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let body = match body {
            Some(body) => {
                request = request.header(header::CONTENT_TYPE, "application/json");
                Body::from(body.to_string())
            }
            None => Body::empty(),
        };
        let response = self
            .router
            .clone()
            .oneshot(request.body(body).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, value)
    }

    async fn get(&self, uri: &str, token: &str) -> (StatusCode, Value) {
        self.send(Method::GET, uri, Some(token), None).await
    }

    async fn post(&self, uri: &str, token: &str, body: Value) -> (StatusCode, Value) {
        self.send(Method::POST, uri, Some(token), Some(body)).await
    }

    async fn put(&self, uri: &str, token: &str, body: Value) -> (StatusCode, Value) {
        self.send(Method::PUT, uri, Some(token), Some(body)).await
    }

    async fn delete(&self, uri: &str, token: &str) -> StatusCode {
        self.send(Method::DELETE, uri, Some(token), None).await.0
    }

    /// Registers an account and returns a token for it.
    async fn sign_up(&self, email: &str) -> String {
        let (status, _) = self
            .send(
                Method::POST,
                "/v1/users",
                None,
                Some(json!({
                    "name": "Alex",
                    "email": email,
                    "password": "correct horse",
                    "weightUnit": "kg",
                    "locale": "fr"
                })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED);
        let (status, body) = self
            .send(
                Method::POST,
                "/v1/tokens",
                None,
                Some(json!({ "email": email, "password": "correct horse" })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED);
        body["token"].as_str().unwrap().to_owned()
    }

    async fn exercise_id(&self, token: &str, name: &str) -> String {
        let (status, body) = self
            .get(&format!("/v1/exercises?q={}", urlencode(name)), token)
            .await;
        assert_eq!(status, StatusCode::OK);
        body["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["name"] == name)
            .unwrap_or_else(|| panic!("no exercise named {name}"))["id"]
            .as_str()
            .unwrap()
            .to_owned()
    }
}

fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn field_paths(problem: &Value) -> Vec<String> {
    problem["errors"]
        .as_array()
        .map(|errors| {
            errors
                .iter()
                .map(|e| e["field"].as_str().unwrap().to_owned())
                .collect()
        })
        .unwrap_or_default()
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn signs_up_logs_in_and_out(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;

    let (status, me) = app.get("/v1/users/me", &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["email"], "alex@example.com");
    assert_eq!(me["weightUnit"], "kg");

    assert_eq!(
        app.delete("/v1/tokens/current", &token).await,
        StatusCode::NO_CONTENT
    );
    let (status, problem) = app.get("/v1/users/me", &token).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(problem["type"], "urn:repsheet:problem:unauthenticated");
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn rejects_duplicate_emails_and_wrong_passwords(pool: PgPool) {
    let app = TestApp::new(pool);
    app.sign_up("alex@example.com").await;

    let (status, _) = app
        .send(
            Method::POST,
            "/v1/users",
            None,
            Some(json!({
                "name": "Other",
                "email": "ALEX@example.com",
                "password": "whatever123",
                "weightUnit": "lb",
                "locale": "en"
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, problem) = app
        .send(
            Method::POST,
            "/v1/tokens",
            None,
            Some(json!({ "email": "alex@example.com", "password": "wrong password" })),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(problem["type"], "urn:repsheet:problem:invalid-credentials");
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn validates_sign_up_fields(pool: PgPool) {
    let app = TestApp::new(pool);
    let (status, problem) = app
        .send(
            Method::POST,
            "/v1/users",
            None,
            Some(json!({
                "name": "  ",
                "email": "not an email",
                "password": "short",
                "weightUnit": "kg",
                "locale": "fr"
            })),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let mut paths = field_paths(&problem);
    paths.sort();
    assert_eq!(paths, vec!["email", "name", "password"]);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn searches_the_catalog_ignoring_case_and_accents(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;

    let (status, page) = app.get("/v1/exercises?q=DEVELOPPE%20Inclin", &token).await;
    assert_eq!(status, StatusCode::OK);
    let names: Vec<&str> = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["Développé incliné"]);
    assert_eq!(page["total"], 1);
    assert_eq!(page["perPage"], 50);

    let (status, _) = app.get("/v1/exercises?perPage=101", &token).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn custom_exercises_are_private_and_unique(pool: PgPool) {
    let app = TestApp::new(pool);
    let alex = app.sign_up("alex@example.com").await;
    let sam = app.sign_up("sam@example.com").await;

    let (status, created) = app
        .post(
            "/v1/exercises",
            &alex,
            json!({ "names": { "fr": "Développé Arnold" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [] }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["custom"], true);
    assert_eq!(created["unilateral"], false);

    let (status, _) = app
        .post(
            "/v1/exercises",
            &alex,
            json!({ "names": { "fr": "developpe arnold" }, "modes": ["reps"], "defaultMode": "reps", "load": "optional", "equipment": ["other"], "defaultEquipment": "other", "grips": [] }),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = app
        .post(
            "/v1/exercises",
            &alex,
            json!({ "names": { "fr": "SQUAT" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["barbell"], "defaultEquipment": "barbell", "grips": [] }),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "built-in names are taken too");

    let uri = format!("/v1/exercises/{}", created["id"].as_str().unwrap());
    assert_eq!(app.get(&uri, &sam).await.0, StatusCode::NOT_FOUND);
    assert_eq!(app.get(&uri, &alex).await.0, StatusCode::OK);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn logs_blocks_in_a_workout(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let incline = app.exercise_id(&token, "Développé incliné").await;
    let flyes = app.exercise_id(&token, "Écarté poulie").await;

    let (status, workout) = app
        .post(
            "/v1/workouts",
            &token,
            json!({ "name": "Push A", "performedOn": "2026-10-22" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(workout["performedOn"], "2026-10-22");
    assert!(workout["durationMinutes"].is_null());
    let workout_uri = format!("/v1/workouts/{}", workout["id"].as_str().unwrap());

    let (status, block) = app
        .post(
            &format!("{workout_uri}/blocks"),
            &token,
            json!({
                "restSeconds": 90,
                "exercises": [
                    { "exerciseId": incline, "equipment": "dumbbell", "sets": [
                        { "round": 1, "reps": 10, "weightKg": 22.0 },
                        { "round": 2, "reps": 10, "weightKg": 22.0 }
                    ]},
                    { "exerciseId": flyes, "sets": [
                        { "round": 1, "reps": 12, "weightKg": 15.0 },
                        { "round": 2, "reps": 12, "weightKg": 12.5 }
                    ]}
                ]
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(block["kind"], "superset");
    assert_eq!(block["position"], 1);
    assert_eq!(block["exercises"][1]["sets"][1]["weightKg"], 12.5);
    assert_eq!(block["exercises"][0]["equipment"], "dumbbell");

    let (status, fetched) = app.get(&workout_uri, &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(fetched["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(
        fetched["blocks"][0]["exercises"][0]["exercise"]["name"],
        "Développé incliné"
    );
    assert_eq!(
        fetched["blocks"][0]["exercises"][0]["equipment"],
        "dumbbell"
    );

    let block_uri = format!("{workout_uri}/blocks/{}", block["id"].as_str().unwrap());
    let (status, replaced) = app
        .put(
            &block_uri,
            &token,
            json!({ "exercises": [
                { "exerciseId": incline, "sets": [{ "round": 1, "reps": 8, "weightKg": 24.0 }] }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replaced["kind"], "simple");
    assert_eq!(replaced["id"], block["id"]);
    assert_eq!(
        replaced["exercises"][0]["equipment"], "barbell",
        "defaults to the default equipment"
    );

    let (status, performances) = app
        .get(&format!("/v1/exercises/{incline}/performances"), &token)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(performances["total"], 1);
    assert_eq!(performances["items"][0]["workoutName"], "Push A");
    assert_eq!(performances["items"][0]["sets"][0]["weightKg"], 24.0);

    let (_, exercise) = app.get(&format!("/v1/exercises/{incline}"), &token).await;
    assert!(exercise["lastUsedOn"].is_string());
    let (_, recent) = app
        .get("/v1/exercises?sort=-lastUsedOn&perPage=1", &token)
        .await;
    assert_eq!(recent["items"][0]["id"], incline.as_str());

    let (status, ended) = app
        .put(
            &workout_uri,
            &token,
            json!({
                "name": "Push A",
                "note": "Bonne séance",
                "performedOn": "2026-10-21",
                "durationMinutes": 55
            }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ended["note"], "Bonne séance");
    assert_eq!(ended["performedOn"], "2026-10-21");
    assert_eq!(ended["durationMinutes"], 55);
    assert_eq!(ended["blocks"].as_array().unwrap().len(), 1);

    assert_eq!(app.delete(&block_uri, &token).await, StatusCode::NO_CONTENT);
    assert_eq!(app.delete(&block_uri, &token).await, StatusCode::NO_CONTENT);
    let (_, list) = app.get("/v1/workouts", &token).await;
    assert_eq!(list["items"][0]["blockCount"], 0);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn checks_sets_against_the_mode_and_the_load(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let squat = app.exercise_id(&token, "Squat").await;
    let plank = app.exercise_id(&token, "Planche").await;
    let (_, workout) = app
        .post(
            "/v1/workouts",
            &token,
            json!({ "name": "Legs", "performedOn": "2026-10-22" }),
        )
        .await;
    let uri = format!("/v1/workouts/{}/blocks", workout["id"].as_str().unwrap());

    let (status, problem) = app
        .post(
            &uri,
            &token,
            json!({ "exercises": [
                { "exerciseId": squat, "sets": [{ "round": 1, "reps": 5 }] },
                { "exerciseId": plank, "sets": [{ "round": 1, "durationSeconds": 45, "reps": 3 }] },
                { "exerciseId": "00000000-0000-0000-0000-000000000000", "sets": [{ "round": 1 }] }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        field_paths(&problem),
        vec![
            "exercises[0].sets[0].weightKg",
            "exercises[1].sets[0].reps",
            "exercises[2].exerciseId",
        ]
    );

    let (status, problem) = app.post(&uri, &token, json!({ "exercises": [] })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["exercises"]);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn workouts_belong_to_their_owner(pool: PgPool) {
    let app = TestApp::new(pool);
    let alex = app.sign_up("alex@example.com").await;
    let sam = app.sign_up("sam@example.com").await;
    let (_, workout) = app
        .post(
            "/v1/workouts",
            &alex,
            json!({ "name": "Mine", "performedOn": "2026-10-22" }),
        )
        .await;
    let uri = format!("/v1/workouts/{}", workout["id"].as_str().unwrap());

    assert_eq!(app.get(&uri, &sam).await.0, StatusCode::NOT_FOUND);
    assert_eq!(app.delete(&uri, &sam).await, StatusCode::NO_CONTENT);
    assert_eq!(app.get(&uri, &alex).await.0, StatusCode::OK);
    assert_eq!(
        app.get("/v1/workouts/not-a-uuid", &alex).await.0,
        StatusCode::NOT_FOUND
    );

    let (status, problem) = app
        .put(
            &uri,
            &alex,
            json!({
                "name": "Mine",
                "note": null,
                "performedOn": "2026-10-22",
                "durationMinutes": 0
            }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(problem["type"], "urn:repsheet:problem:validation");
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn follows_and_edits_templates(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let other = app.sign_up("sam@example.com").await;
    let bench = app.exercise_id(&token, "Développé couché").await;
    let dips = app.exercise_id(&token, "Dips").await;
    let swing = app.exercise_id(&token, "Kettlebell swing").await;
    let plank = app.exercise_id(&token, "Planche").await;

    let (status, template) = app
        .post(
            "/v1/templates",
            &token,
            json!({
                "name": "Push A",
                "note": "Contrôler la descente",
                "blocks": [
                    { "restSeconds": 150, "exercises": [{ "exerciseId": bench, "target": "6–8" }] },
                    { "rounds": 3, "exercises": [
                        { "exerciseId": dips, "target": "max" },
                        { "exerciseId": swing, "target": "15" },
                        { "exerciseId": plank, "target": "45 s" }
                    ]}
                ]
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(template["blocks"][1]["kind"], "circuit");
    assert_eq!(template["blocks"][1]["exercises"][2]["target"], "45 s");
    let template_id = template["id"].as_str().unwrap();
    let circuit_id = template["blocks"][1]["id"].as_str().unwrap();

    let (status, workout) = app
        .post(
            "/v1/workouts",
            &token,
            json!({ "name": "Push A", "templateId": template_id, "performedOn": "2026-10-22" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(workout["templateId"], template_id);

    let (status, block) = app
        .post(
            &format!("/v1/workouts/{}/blocks", workout["id"].as_str().unwrap()),
            &token,
            json!({
                "templateBlockId": circuit_id,
                "exercises": [{ "exerciseId": plank, "sets": [{ "round": 1, "durationSeconds": 45 }] }]
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(block["templateBlockId"], circuit_id);

    let uri = format!("/v1/templates/{template_id}");
    let (status, updated) = app
        .put(
            &uri,
            &token,
            json!({
                "name": "Push A",
                "note": null,
                "blocks": [
                    { "id": circuit_id, "rounds": 4, "exercises": [{ "exerciseId": plank }] },
                    { "exercises": [{ "exerciseId": bench, "target": "5" }] }
                ]
            }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["blocks"][0]["id"], circuit_id);
    assert_eq!(updated["blocks"][0]["rounds"], 4);
    assert_eq!(updated["blocks"].as_array().unwrap().len(), 2);
    assert!(updated["note"].is_null());

    let (status, problem) = app
        .put(
            &uri,
            &token,
            json!({
                "name": "Push A",
                "blocks": [{ "id": "00000000-0000-0000-0000-000000000000", "exercises": [{ "exerciseId": plank }] }]
            }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["blocks[0].id"]);

    assert_eq!(app.get(&uri, &other).await.0, StatusCode::NOT_FOUND);
    let (status, problem) = app
        .post(
            "/v1/workouts",
            &other,
            json!({ "name": "Not mine", "templateId": template_id, "performedOn": "2026-10-22" }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["templateId"]);

    assert_eq!(app.delete(&uri, &token).await, StatusCode::NO_CONTENT);
    let (_, workout) = app
        .get(
            &format!("/v1/workouts/{}", workout["id"].as_str().unwrap()),
            &token,
        )
        .await;
    assert!(workout["templateId"].is_null());
    assert!(workout["blocks"][0]["templateBlockId"].is_null());
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn serves_the_openapi_document_and_the_probe(pool: PgPool) {
    let app = TestApp::new(pool);
    let (status, document) = app.send(Method::GET, "/openapi.json", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(document["paths"]["/v1/workouts/{workoutId}/blocks"]["post"].is_object());
    assert!(document["components"]["securitySchemes"]["BearerAuth"].is_object());
    assert!(document["paths"].get("/healthz").is_none());
    for schema in ["CreateExerciseRequest", "UpdateExerciseRequest"] {
        let required = &document["components"]["schemas"][schema]["required"];
        assert!(
            required.as_array().unwrap().contains(&json!("grips")),
            "{schema} requires {required}"
        );
    }
    let grip_filter = &document["components"]["schemas"]["GripFilter"];
    assert_eq!(
        grip_filter["enum"],
        json!(["pronation", "supination", "neutral", "mixed", "none"]),
        "{grip_filter}"
    );

    let response = app
        .router
        .clone()
        .oneshot(Request::get("/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn upserts_the_super_admin_on_start_up(pool: PgPool) {
    let app = TestApp::new(pool.clone());
    let token = app.super_admin().await;
    let (_, me) = app.get("/v1/users/me", &token).await;
    assert_eq!(me["role"], "superAdmin");

    ensure_super_admin(&pool, "ADMIN@example.com", "rotated password".to_owned())
        .await
        .unwrap();
    assert_eq!(
        app.log_in(ADMIN_EMAIL, ADMIN_PASSWORD).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.log_in(ADMIN_EMAIL, "rotated password").await.0,
        StatusCode::CREATED
    );
    let (_, page) = app.get("/v1/users", &token).await;
    assert_eq!(
        page["total"], 1,
        "the upsert never creates a second account"
    );

    assert!(
        ensure_super_admin(&pool, "not an email", "long enough".to_owned())
            .await
            .is_err()
    );
    assert!(
        ensure_super_admin(&pool, ADMIN_EMAIL, "short".to_owned())
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn promotes_an_existing_account_to_super_admin(pool: PgPool) {
    let app = TestApp::new(pool.clone());
    let token = app.sign_up("alex@example.com").await;
    let (_, me) = app.get("/v1/users/me", &token).await;
    assert_eq!(me["role"], "user");

    ensure_super_admin(&pool, "alex@example.com", "new password".to_owned())
        .await
        .unwrap();
    let (_, me) = app.get("/v1/users/me", &token).await;
    assert_eq!(me["role"], "superAdmin");
    assert_eq!(me["name"], "Alex", "an existing account keeps its name");
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn super_admins_manage_accounts(pool: PgPool) {
    let app = TestApp::new(pool);
    let admin = app.super_admin().await;
    let alex = app.sign_up("alex@example.com").await;
    app.sign_up("sam@example.com").await;
    let alex_id = app.user_id(&alex).await;
    let admin_id = app.user_id(&admin).await;

    assert_eq!(app.get("/v1/users", &alex).await.0, StatusCode::FORBIDDEN);
    let (status, page) = app.get("/v1/users?q=SAM", &admin).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["total"], 1);
    assert_eq!(page["items"][0]["email"], "sam@example.com");

    let role_uri = format!("/v1/users/{alex_id}/role");
    let (status, _) = app
        .put(&role_uri, &alex, json!({ "role": "superAdmin" }))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, promoted) = app
        .put(&role_uri, &admin, json!({ "role": "superAdmin" }))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(promoted["role"], "superAdmin");
    assert_eq!(app.get("/v1/users", &alex).await.0, StatusCode::OK);

    let (status, _) = app
        .put(
            &format!("/v1/users/{admin_id}/role"),
            &admin,
            json!({ "role": "user" }),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        app.delete(&format!("/v1/users/{admin_id}"), &admin).await,
        StatusCode::CONFLICT
    );
    let (status, _) = app
        .put(
            "/v1/users/00000000-0000-0000-0000-000000000000/role",
            &admin,
            json!({ "role": "user" }),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn deleting_an_account_deletes_its_data(pool: PgPool) {
    let app = TestApp::new(pool);
    let admin = app.super_admin().await;
    let alex = app.sign_up("alex@example.com").await;
    let alex_id = app.user_id(&alex).await;
    let (_, custom) = app
        .post(
            "/v1/exercises",
            &alex,
            json!({ "names": { "fr": "Curl araignée" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [] }),
        )
        .await;
    let (_, workout) = app
        .post(
            "/v1/workouts",
            &alex,
            json!({ "name": "Bras", "performedOn": "2026-10-22" }),
        )
        .await;
    let (status, _) = app
        .post(
            &format!("/v1/workouts/{}/blocks", workout["id"].as_str().unwrap()),
            &alex,
            json!({ "exercises": [{ "exerciseId": custom["id"], "sets": [
                { "round": 1, "reps": 12, "weightKg": 10.0 }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);

    assert_eq!(
        app.delete(&format!("/v1/users/{alex_id}"), &alex).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.delete(&format!("/v1/users/{alex_id}"), &admin).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.get("/v1/users/me", &alex).await.0,
        StatusCode::UNAUTHORIZED
    );
    let (_, page) = app.get("/v1/users", &admin).await;
    assert_eq!(page["total"], 1);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn super_admins_curate_the_catalog(pool: PgPool) {
    let app = TestApp::new(pool);
    let admin = app.super_admin().await;
    let alex = app.sign_up("alex@example.com").await;

    let new_exercise = json!({
        "names": { "fr": "Pull-over", "en": "Dumbbell pullover" },
        "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [], "builtIn": true
    });
    let (status, _) = app.post("/v1/exercises", &alex, new_exercise.clone()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, created) = app
        .post("/v1/exercises", &admin, new_exercise.clone())
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["custom"], false);
    let (status, _) = app.post("/v1/exercises", &admin, new_exercise).await;
    assert_eq!(status, StatusCode::CONFLICT);

    let uri = format!("/v1/exercises/{}", created["id"].as_str().unwrap());
    assert_eq!(
        app.get(&uri, &alex).await.0,
        StatusCode::OK,
        "visible to everyone"
    );
    let edit = json!({
        "names": { "fr": "Pull-over haltère", "en": "Dumbbell pullover" },
        "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [], "unilateral": false
    });
    assert_eq!(
        app.put(&uri, &alex, edit.clone()).await.0,
        StatusCode::FORBIDDEN
    );
    let (status, renamed) = app.put(&uri, &admin, edit).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(renamed["name"], "Pull-over haltère");
    assert_eq!(app.delete(&uri, &alex).await, StatusCode::FORBIDDEN);
    assert_eq!(app.delete(&uri, &admin).await, StatusCode::NO_CONTENT);
    assert_eq!(app.get(&uri, &alex).await.0, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn owners_edit_their_exercises_without_breaking_history(pool: PgPool) {
    let app = TestApp::new(pool);
    let alex = app.sign_up("alex@example.com").await;
    let (_, custom) = app
        .post(
            "/v1/exercises",
            &alex,
            json!({ "names": { "fr": "Curl araignée" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [] }),
        )
        .await;
    let uri = format!("/v1/exercises/{}", custom["id"].as_str().unwrap());

    let (status, _) = app
        .put(
            &uri,
            &alex,
            json!({ "names": { "fr": "Squat" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [], "unilateral": false }),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "a built-in exercise already has the name"
    );

    let (_, workout) = app
        .post(
            "/v1/workouts",
            &alex,
            json!({ "name": "Bras", "performedOn": "2026-10-22" }),
        )
        .await;
    app.post(
        &format!("/v1/workouts/{}/blocks", workout["id"].as_str().unwrap()),
        &alex,
        json!({ "exercises": [{ "exerciseId": custom["id"], "sets": [
            { "round": 1, "reps": 12, "weightKg": 10.0 }
        ]}]}),
    )
    .await;

    let (status, _) = app
        .put(
            &uri,
            &alex,
            json!({ "names": { "fr": "Curl araignée" }, "modes": ["time"], "defaultMode": "time", "load": "none", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [], "unilateral": false }),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "a mode with logged sets cannot be removed"
    );
    let (status, updated) = app
        .put(
            &uri,
            &alex,
            json!({ "names": { "fr": "Spider curl" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [], "unilateral": true }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["unilateral"], true);
    assert!(updated["lastUsedOn"].is_string());

    assert_eq!(app.delete(&uri, &alex).await, StatusCode::CONFLICT);
    let squat = app.exercise_id(&alex, "Squat").await;
    let builtin_uri = format!("/v1/exercises/{squat}");
    assert_eq!(app.delete(&builtin_uri, &alex).await, StatusCode::FORBIDDEN);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn last_time_means_the_workout_before(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let squat = app.exercise_id(&token, "Squat").await;

    // Logged out of order: the 20th is entered after the 22nd.
    let mut ids = Vec::new();
    for (day, weight) in [
        ("2026-10-15", 80.0),
        ("2026-10-22", 90.0),
        ("2026-10-20", 85.0),
    ] {
        let (_, workout) = app
            .post(
                "/v1/workouts",
                &token,
                json!({ "name": "Legs", "performedOn": day }),
            )
            .await;
        let id = workout["id"].as_str().unwrap().to_owned();
        app.post(
            &format!("/v1/workouts/{id}/blocks"),
            &token,
            json!({ "exercises": [{ "exerciseId": squat, "sets": [
                { "round": 1, "reps": 5, "weightKg": weight }
            ]}]}),
        )
        .await;
        ids.push(id);
    }

    let (_, all) = app
        .get(&format!("/v1/exercises/{squat}/performances"), &token)
        .await;
    let days: Vec<&str> = all["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["performedOn"].as_str().unwrap())
        .collect();
    assert_eq!(days, vec!["2026-10-22", "2026-10-20", "2026-10-15"]);

    let (_, before) = app
        .get(
            &format!(
                "/v1/exercises/{squat}/performances?beforeWorkoutId={}&perPage=1",
                ids[2]
            ),
            &token,
        )
        .await;
    assert_eq!(before["total"], 1);
    assert_eq!(before["items"][0]["performedOn"], "2026-10-15");
    assert_eq!(before["items"][0]["sets"][0]["weightKg"], 80.0);

    let (_, workouts) = app.get("/v1/workouts", &token).await;
    assert_eq!(workouts["items"][0]["performedOn"], "2026-10-22");
    let (_, exercise) = app.get(&format!("/v1/exercises/{squat}"), &token).await;
    assert_eq!(exercise["lastUsedOn"], "2026-10-22");
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn names_exercises_in_the_user_language(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;

    let (_, page) = app.get("/v1/exercises?q=bench%20press", &token).await;
    assert_eq!(
        page["items"][0]["name"], "Développé couché",
        "searched in English, named in French"
    );
    assert_eq!(page["items"][0]["names"]["en"], "Bench press");

    let (status, me) = app
        .put(
            "/v1/users/me/preferences",
            &token,
            json!({ "locale": "en", "weightUnit": "lb" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["locale"], "en");
    assert_eq!(me["weightUnit"], "lb");
    let (_, page) = app.get("/v1/exercises?q=developpe%20couche", &token).await;
    assert_eq!(page["items"][0]["name"], "Bench press");

    let (_, custom) = app
        .post(
            "/v1/exercises",
            &token,
            json!({ "names": { "fr": "Curl araignée" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [] }),
        )
        .await;
    assert_eq!(
        custom["name"], "Curl araignée",
        "falls back on the only name it has"
    );
    assert!(custom["names"]["en"].is_null());

    let (status, _) = app
        .post(
            "/v1/exercises",
            &token,
            json!({ "names": { "en": "BENCH PRESS" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["barbell"], "defaultEquipment": "barbell", "grips": [] }),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "names collide across languages"
    );

    let (status, problem) = app
        .post(
            "/v1/exercises",
            &token,
            json!({ "names": {}, "modes": ["reps"], "defaultMode": "reps", "load": "optional", "equipment": ["other"], "defaultEquipment": "other", "grips": [] }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["names"]);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn catalog_exercises_need_both_names(pool: PgPool) {
    let app = TestApp::new(pool);
    let admin = app.super_admin().await;
    let (status, problem) = app
        .post(
            "/v1/exercises",
            &admin,
            json!({ "names": { "fr": "Pull-over" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [], "builtIn": true }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["names.en"]);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn conflicts_say_which_rule_they_break(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let (_, custom) = app
        .post(
            "/v1/exercises",
            &token,
            json!({ "names": { "fr": "Curl araignée" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [] }),
        )
        .await;
    let uri = format!("/v1/exercises/{}", custom["id"].as_str().unwrap());
    let (_, workout) = app
        .post(
            "/v1/workouts",
            &token,
            json!({ "name": "Bras", "performedOn": "2026-10-22" }),
        )
        .await;
    app.post(
        &format!("/v1/workouts/{}/blocks", workout["id"].as_str().unwrap()),
        &token,
        json!({ "exercises": [{ "exerciseId": custom["id"], "sets": [
            { "round": 1, "reps": 12, "weightKg": 10.0 }
        ]}]}),
    )
    .await;

    let cases = [
        (
            app.put(
                &uri,
                &token,
                json!({ "names": { "fr": "Curl araignée" }, "modes": ["time"], "defaultMode": "time", "load": "none", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [], "unilateral": false }),
            )
            .await,
            "urn:repsheet:problem:mode-locked",
        ),
        (
            app.put(
                &uri,
                &token,
                json!({ "names": { "fr": "Squat" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["dumbbell"], "defaultEquipment": "dumbbell", "grips": [], "unilateral": false }),
            )
            .await,
            "urn:repsheet:problem:exercise-name-taken",
        ),
        (
            app.send(Method::DELETE, &uri, Some(&token), None).await,
            "urn:repsheet:problem:exercise-in-use",
        ),
        (
            app.send(
                Method::POST,
                "/v1/users",
                None,
                Some(json!({
                    "name": "Alex", "email": "alex@example.com", "password": "correct horse",
                    "weightUnit": "kg", "locale": "fr"
                })),
            )
            .await,
            "urn:repsheet:problem:email-taken",
        ),
    ];
    for ((status, problem), kind) in cases {
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(problem["type"], kind);
    }
}

async fn new_workout(app: &TestApp, token: &str, day: &str) -> String {
    let (status, workout) = app
        .post(
            "/v1/workouts",
            token,
            json!({ "name": "Push A", "performedOn": day }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    workout["id"].as_str().unwrap().to_owned()
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn describes_how_exercises_are_counted(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let crunch = app.exercise_id(&token, "Crunch").await;
    let (_, exercise) = app.get(&format!("/v1/exercises/{crunch}"), &token).await;
    assert_eq!(exercise["modes"], json!(["reps", "time"]));
    assert_eq!(exercise["defaultMode"], "reps");
    assert_eq!(exercise["load"], "none");

    let (status, created) = app
        .post(
            "/v1/exercises",
            &token,
            json!({
                "names": { "fr": "Crunch oblique" },
                "modes": ["time", "reps"], "defaultMode": "time", "load": "optional",
                "equipment": ["bodyweight"], "defaultEquipment": "bodyweight", "grips": []
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        created["modes"],
        json!(["reps", "time"]),
        "in the fixed order"
    );
    assert_eq!(created["defaultMode"], "time");

    for (body, field) in [
        (
            json!({ "modes": [], "defaultMode": "reps", "load": "none" }),
            "modes",
        ),
        (
            json!({ "modes": ["reps", "reps"], "defaultMode": "reps", "load": "none" }),
            "modes",
        ),
        (
            json!({ "modes": ["reps"], "defaultMode": "time", "load": "none" }),
            "defaultMode",
        ),
    ] {
        let mut body = body;
        body["names"] = json!({ "fr": "Gainage dynamique" });
        body["equipment"] = json!(["bodyweight"]);
        body["defaultEquipment"] = json!("bodyweight");
        body["grips"] = json!([]);
        let (status, problem) = app.post("/v1/exercises", &token, body).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(field_paths(&problem), vec![field]);
    }
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn blocks_count_each_exercise_in_one_of_its_modes(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let crunch = app.exercise_id(&token, "Crunch").await;
    let dips = app.exercise_id(&token, "Dips").await;
    let workout = new_workout(&app, &token, "2026-10-22").await;
    let uri = format!("/v1/workouts/{workout}/blocks");

    let (status, block) = app
        .post(
            &uri,
            &token,
            json!({ "exercises": [
                { "exerciseId": crunch, "sets": [{ "round": 1, "reps": 20 }] },
                { "exerciseId": dips, "sets": [{ "round": 1, "reps": 8, "weightKg": -15.0 }] }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        block["exercises"][0]["mode"], "reps",
        "defaults to the default mode"
    );
    assert_eq!(
        block["exercises"][0]["exercise"]["modes"],
        json!(["reps", "time"])
    );

    let (status, block) = app
        .post(
            &uri,
            &token,
            json!({ "exercises": [
                { "exerciseId": crunch, "mode": "time", "sets": [
                    { "round": 1, "durationSeconds": 60 },
                    { "round": 2, "durationSeconds": 50 }
                ]}
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(block["exercises"][0]["mode"], "time");
    assert_eq!(block["exercises"][0]["sets"][1]["durationSeconds"], 50);

    let (status, problem) = app
        .post(
            &uri,
            &token,
            json!({ "exercises": [
                { "exerciseId": crunch, "mode": "distance", "sets": [{ "round": 1, "distanceMeters": 10 }] },
                { "exerciseId": dips, "mode": "time", "sets": [{ "round": 1, "durationSeconds": 30 }] }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        field_paths(&problem),
        vec!["exercises[0].mode", "exercises[1].mode"]
    );

    let (status, problem) = app
        .post(
            &uri,
            &token,
            json!({ "exercises": [
                { "exerciseId": crunch, "mode": "time", "sets": [{ "round": 1, "reps": 20, "weightKg": 5.0 }] }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        field_paths(&problem),
        vec![
            "exercises[0].sets[0].reps",
            "exercises[0].sets[0].weightKg",
            "exercises[0].sets[0].durationSeconds",
        ]
    );
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn filters_performances_by_mode(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let crunch = app.exercise_id(&token, "Crunch").await;
    let mut workouts = Vec::new();
    for (day, mode, set) in [
        (
            "2026-10-08",
            "time",
            json!({ "round": 1, "durationSeconds": 45 }),
        ),
        ("2026-10-15", "reps", json!({ "round": 1, "reps": 20 })),
        (
            "2026-10-22",
            "time",
            json!({ "round": 1, "durationSeconds": 60 }),
        ),
    ] {
        let workout = new_workout(&app, &token, day).await;
        let (status, _) = app
            .post(
                &format!("/v1/workouts/{workout}/blocks"),
                &token,
                json!({ "exercises": [{ "exerciseId": crunch, "mode": mode, "sets": [set] }] }),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED);
        workouts.push(workout);
    }
    let uri = format!("/v1/exercises/{crunch}/performances");

    let (_, all) = app.get(&uri, &token).await;
    assert_eq!(all["total"], 3);
    assert_eq!(all["items"][1]["mode"], "reps");

    let (_, timed) = app.get(&format!("{uri}?mode=time"), &token).await;
    assert_eq!(timed["total"], 2);
    let modes: Vec<&str> = timed["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["mode"].as_str().unwrap())
        .collect();
    assert_eq!(modes, vec!["time", "time"]);

    let (_, last_time) = app
        .get(
            &format!("{uri}?mode=time&beforeWorkoutId={}&perPage=1", workouts[2]),
            &token,
        )
        .await;
    assert_eq!(last_time["total"], 1);
    assert_eq!(last_time["items"][0]["performedOn"], "2026-10-08");

    let (status, _) = app.get(&format!("{uri}?mode=swim"), &token).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn logged_modes_cannot_be_removed(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let (_, custom) = app
        .post(
            "/v1/exercises",
            &token,
            json!({
                "names": { "fr": "Crunch oblique" },
                "modes": ["reps", "time", "distance"], "defaultMode": "reps", "load": "none",
                "equipment": ["bodyweight"], "defaultEquipment": "bodyweight", "grips": []
            }),
        )
        .await;
    let id = custom["id"].as_str().unwrap();
    let uri = format!("/v1/exercises/{id}");
    let workout = new_workout(&app, &token, "2026-10-22").await;
    let (status, _) = app
        .post(
            &format!("/v1/workouts/{workout}/blocks"),
            &token,
            json!({ "exercises": [{ "exerciseId": id, "mode": "time", "sets": [
                { "round": 1, "durationSeconds": 40 }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, template) = app
        .post(
            "/v1/templates",
            &token,
            json!({ "name": "Abdos", "blocks": [
                { "exercises": [{ "exerciseId": id, "mode": "distance", "target": "20 m" }] }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);

    let edit = |modes: Value, default_mode: &str, load: &str| {
        json!({
            "names": { "fr": "Crunch oblique" }, "modes": modes, "defaultMode": default_mode,
            "load": load, "equipment": ["bodyweight"], "defaultEquipment": "bodyweight", "grips": [], "unilateral": false
        })
    };
    let (status, problem) = app
        .put(
            &uri,
            &token,
            edit(json!(["reps", "distance"]), "reps", "none"),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(problem["type"], "urn:repsheet:problem:mode-locked");

    let (status, updated) = app
        .put(
            &uri,
            &token,
            edit(json!(["time", "reps"]), "time", "optional"),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "reps and distance were never logged"
    );
    assert_eq!(updated["modes"], json!(["reps", "time"]));
    assert_eq!(updated["load"], "optional");

    let (_, template) = app
        .get(
            &format!("/v1/templates/{}", template["id"].as_str().unwrap()),
            &token,
        )
        .await;
    assert_eq!(
        template["blocks"][0]["exercises"][0]["mode"], "time",
        "a removed mode falls back on the default mode"
    );
    assert_eq!(template["blocks"][0]["exercises"][0]["target"], "20 m");
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn templates_keep_the_mode_with_the_target(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let crunch = app.exercise_id(&token, "Crunch").await;
    let bench = app.exercise_id(&token, "Développé couché").await;

    let (status, template) = app
        .post(
            "/v1/templates",
            &token,
            json!({ "name": "Push A", "blocks": [{ "rounds": 3, "exercises": [
                { "exerciseId": bench, "target": "6–8" },
                { "exerciseId": crunch, "mode": "time", "target": "1 min" }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let exercises = &template["blocks"][0]["exercises"];
    assert_eq!(exercises[0]["mode"], "reps");
    assert_eq!(exercises[1]["mode"], "time");
    assert_eq!(exercises[1]["target"], "1 min");

    let uri = format!("/v1/templates/{}", template["id"].as_str().unwrap());
    let (status, problem) = app
        .put(
            &uri,
            &token,
            json!({ "name": "Push A", "blocks": [{ "exercises": [
                { "exerciseId": crunch, "mode": "time" },
                { "exerciseId": bench, "mode": "time" }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["blocks[0].exercises[1].mode"]);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn describes_the_equipment_of_exercises(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let bench = app.exercise_id(&token, "Développé couché").await;
    let (_, exercise) = app.get(&format!("/v1/exercises/{bench}"), &token).await;
    assert_eq!(exercise["equipment"], json!(["barbell", "dumbbell"]));
    assert_eq!(exercise["defaultEquipment"], "barbell");

    let (status, created) = app
        .post(
            "/v1/exercises",
            &token,
            json!({
                "names": { "fr": "Développé Arnold" },
                "modes": ["reps"], "defaultMode": "reps", "load": "required",
                "equipment": ["kettlebell", "dumbbell"], "defaultEquipment": "kettlebell", "grips": []
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        created["equipment"],
        json!(["dumbbell", "kettlebell"]),
        "in the fixed order"
    );
    assert_eq!(created["defaultEquipment"], "kettlebell");

    for (equipment, default_equipment, field) in [
        (json!([]), "barbell", "equipment"),
        (json!(["cable", "cable"]), "cable", "equipment"),
        (json!(["cable"]), "machine", "defaultEquipment"),
    ] {
        let (status, problem) = app
            .post(
                "/v1/exercises",
                &token,
                json!({
                    "names": { "fr": "Tirage nuque" },
                    "modes": ["reps"], "defaultMode": "reps", "load": "required",
                    "equipment": equipment, "defaultEquipment": default_equipment, "grips": []
                }),
            )
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(field_paths(&problem), vec![field]);
    }
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn blocks_and_templates_do_each_exercise_with_one_of_its_equipment(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let bench = app.exercise_id(&token, "Développé couché").await;
    let workout = new_workout(&app, &token, "2026-10-22").await;
    let uri = format!("/v1/workouts/{workout}/blocks");

    let (status, problem) = app
        .post(
            &uri,
            &token,
            json!({ "exercises": [
                { "exerciseId": bench, "equipment": "machine", "sets": [
                    { "round": 1, "reps": 8, "weightKg": 60.0 }
                ]}
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["exercises[0].equipment"]);

    let (status, template) = app
        .post(
            "/v1/templates",
            &token,
            json!({ "name": "Push A", "blocks": [{ "exercises": [
                { "exerciseId": bench, "equipment": "dumbbell", "target": "8" }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        template["blocks"][0]["exercises"][0]["equipment"],
        "dumbbell"
    );

    let (status, problem) = app
        .put(
            &format!("/v1/templates/{}", template["id"].as_str().unwrap()),
            &token,
            json!({ "name": "Push A", "blocks": [{ "exercises": [
                { "exerciseId": bench, "mode": "time", "equipment": "cable" }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        field_paths(&problem),
        vec![
            "blocks[0].exercises[0].mode",
            "blocks[0].exercises[0].equipment"
        ]
    );
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn filters_performances_by_equipment(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let bench = app.exercise_id(&token, "Développé couché").await;
    let mut workouts = Vec::new();
    for (day, equipment, weight) in [
        ("2026-10-08", "barbell", 60.0),
        ("2026-10-15", "dumbbell", 22.0),
        ("2026-10-22", "barbell", 62.5),
    ] {
        let workout = new_workout(&app, &token, day).await;
        let (status, _) = app
            .post(
                &format!("/v1/workouts/{workout}/blocks"),
                &token,
                json!({ "exercises": [{ "exerciseId": bench, "equipment": equipment, "sets": [
                    { "round": 1, "reps": 8, "weightKg": weight }
                ]}]}),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED);
        workouts.push(workout);
    }
    let uri = format!("/v1/exercises/{bench}/performances");

    let (_, all) = app.get(&uri, &token).await;
    assert_eq!(all["total"], 3);
    assert_eq!(all["items"][1]["equipment"], "dumbbell");

    let (_, barbell) = app.get(&format!("{uri}?equipment=barbell"), &token).await;
    assert_eq!(barbell["total"], 2);
    let weights: Vec<f64> = barbell["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["sets"][0]["weightKg"].as_f64().unwrap())
        .collect();
    assert_eq!(weights, vec![62.5, 60.0]);

    let (_, last_time) = app
        .get(
            &format!(
                "{uri}?mode=reps&equipment=barbell&beforeWorkoutId={}&perPage=1",
                workouts[2]
            ),
            &token,
        )
        .await;
    assert_eq!(last_time["total"], 1);
    assert_eq!(
        last_time["items"][0]["performedOn"], "2026-10-08",
        "skips the dumbbell session in between"
    );

    let (status, _) = app.get(&format!("{uri}?equipment=rope"), &token).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn logged_equipment_cannot_be_removed(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let (_, custom) = app
        .post(
            "/v1/exercises",
            &token,
            json!({
                "names": { "fr": "Tirage menton" },
                "modes": ["reps"], "defaultMode": "reps", "load": "required",
                "equipment": ["barbell", "dumbbell", "cable"], "defaultEquipment": "barbell", "grips": []
            }),
        )
        .await;
    let id = custom["id"].as_str().unwrap();
    let uri = format!("/v1/exercises/{id}");
    let workout = new_workout(&app, &token, "2026-10-22").await;
    let (status, _) = app
        .post(
            &format!("/v1/workouts/{workout}/blocks"),
            &token,
            json!({ "exercises": [{ "exerciseId": id, "equipment": "dumbbell", "sets": [
                { "round": 1, "reps": 12, "weightKg": 10.0 }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, template) = app
        .post(
            "/v1/templates",
            &token,
            json!({ "name": "Épaules", "blocks": [
                { "exercises": [{ "exerciseId": id, "equipment": "cable", "target": "12" }] }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);

    let edit = |equipment: Value, default_equipment: &str| {
        json!({
            "names": { "fr": "Tirage menton" }, "modes": ["reps"], "defaultMode": "reps",
            "load": "required", "equipment": equipment, "defaultEquipment": default_equipment, "grips": [],
            "unilateral": false
        })
    };
    let (status, problem) = app
        .put(&uri, &token, edit(json!(["barbell", "cable"]), "barbell"))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(problem["type"], "urn:repsheet:problem:equipment-locked");

    let (status, updated) = app
        .put(
            &uri,
            &token,
            edit(json!(["dumbbell", "barbell"]), "dumbbell"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "cable was never logged");
    assert_eq!(updated["equipment"], json!(["barbell", "dumbbell"]));
    assert_eq!(updated["defaultEquipment"], "dumbbell");

    let (_, template) = app
        .get(
            &format!("/v1/templates/{}", template["id"].as_str().unwrap()),
            &token,
        )
        .await;
    assert_eq!(
        template["blocks"][0]["exercises"][0]["equipment"], "dumbbell",
        "removed equipment falls back on the default equipment"
    );
    assert_eq!(template["blocks"][0]["exercises"][0]["target"], "12");
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn describes_the_grips_of_exercises(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let pulldown = app.exercise_id(&token, "Tirage vertical").await;
    let (_, exercise) = app.get(&format!("/v1/exercises/{pulldown}"), &token).await;
    assert_eq!(
        exercise["grips"],
        json!(["pronation", "supination", "neutral"])
    );
    assert_eq!(exercise["defaultGrip"], "pronation");
    let squat = app.exercise_id(&token, "Squat").await;
    let (_, exercise) = app.get(&format!("/v1/exercises/{squat}"), &token).await;
    assert_eq!(exercise["grips"], json!([]), "the grip does not apply");
    assert_eq!(exercise["defaultGrip"], Value::Null);

    let (status, created) = app
        .post(
            "/v1/exercises",
            &token,
            json!({
                "names": { "fr": "Tirage menton" },
                "modes": ["reps"], "defaultMode": "reps", "load": "required",
                "equipment": ["barbell"], "defaultEquipment": "barbell",
                "grips": ["neutral", "pronation"], "defaultGrip": "neutral"
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        created["grips"],
        json!(["pronation", "neutral"]),
        "in the fixed order"
    );
    assert_eq!(created["defaultGrip"], "neutral");

    let (status, problem) = app
        .post(
            "/v1/exercises",
            &token,
            json!({
                "names": { "fr": "Gainage dynamique" },
                "modes": ["time"], "defaultMode": "time", "load": "none",
                "equipment": ["bodyweight"], "defaultEquipment": "bodyweight"
            }),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "grips are required, if empty"
    );
    assert!(
        problem["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("grips"),
        "{problem}"
    );

    for (grips, default_grip, field) in [
        (json!(["mixed", "mixed"]), json!("mixed"), "grips"),
        (json!(["neutral"]), json!("mixed"), "defaultGrip"),
        (json!(["neutral"]), Value::Null, "defaultGrip"),
        (json!([]), json!("neutral"), "defaultGrip"),
    ] {
        let (status, problem) = app
            .post(
                "/v1/exercises",
                &token,
                json!({
                    "names": { "fr": "Rowing T" },
                    "modes": ["reps"], "defaultMode": "reps", "load": "required",
                    "equipment": ["barbell"], "defaultEquipment": "barbell",
                    "grips": grips, "defaultGrip": default_grip
                }),
            )
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(field_paths(&problem), vec![field]);
    }
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn blocks_and_templates_hold_one_of_the_grips(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let pulldown = app.exercise_id(&token, "Tirage vertical").await;
    let squat = app.exercise_id(&token, "Squat").await;
    let workout = new_workout(&app, &token, "2026-10-22").await;
    let uri = format!("/v1/workouts/{workout}/blocks");
    let set = json!([{ "round": 1, "reps": 10, "weightKg": 50.0 }]);

    let (status, problem) = app
        .post(
            &uri,
            &token,
            json!({ "exercises": [
                { "exerciseId": pulldown, "grip": "mixed", "sets": set },
                { "exerciseId": squat, "grip": "pronation", "sets": set }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        field_paths(&problem),
        vec!["exercises[0].grip", "exercises[1].grip"]
    );

    let (status, block) = app
        .post(
            &uri,
            &token,
            json!({ "exercises": [
                { "exerciseId": pulldown, "grip": "supination", "sets": set },
                { "exerciseId": pulldown, "sets": set },
                { "exerciseId": squat, "sets": set }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let grips: Vec<&Value> = block["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| &e["grip"])
        .collect();
    assert_eq!(
        grips,
        vec![&json!("supination"), &Value::Null, &Value::Null],
        "an omitted grip stays unknown rather than taking the default one"
    );

    let (status, template) = app
        .post(
            "/v1/templates",
            &token,
            json!({ "name": "Dos", "blocks": [{ "exercises": [
                { "exerciseId": pulldown, "grip": "neutral", "target": "10" },
                { "exerciseId": squat }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(template["blocks"][0]["exercises"][0]["grip"], "neutral");
    assert_eq!(template["blocks"][0]["exercises"][1]["grip"], Value::Null);

    let (status, problem) = app
        .put(
            &format!("/v1/templates/{}", template["id"].as_str().unwrap()),
            &token,
            json!({ "name": "Dos", "blocks": [{ "exercises": [
                { "exerciseId": squat, "grip": "neutral" }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["blocks[0].exercises[0].grip"]);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn filters_performances_by_grip(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let pulldown = app.exercise_id(&token, "Tirage vertical").await;
    let mut workouts = Vec::new();
    for (day, grip, weight) in [
        ("2026-10-01", Value::Null, 45.0),
        ("2026-10-08", json!("pronation"), 50.0),
        ("2026-10-15", json!("supination"), 60.0),
        ("2026-10-22", json!("pronation"), 52.5),
    ] {
        let workout = new_workout(&app, &token, day).await;
        let (status, _) = app
            .post(
                &format!("/v1/workouts/{workout}/blocks"),
                &token,
                json!({ "exercises": [{ "exerciseId": pulldown, "grip": grip, "sets": [
                    { "round": 1, "reps": 10, "weightKg": weight }
                ]}]}),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED);
        workouts.push(workout);
    }
    let uri = format!("/v1/exercises/{pulldown}/performances");

    let (_, all) = app.get(&uri, &token).await;
    assert_eq!(all["total"], 4, "no filter without a grip");
    assert_eq!(all["items"][1]["grip"], "supination");
    assert_eq!(all["items"][3]["grip"], Value::Null);

    let weights = |page: &Value| -> Vec<f64> {
        page["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["sets"][0]["weightKg"].as_f64().unwrap())
            .collect()
    };
    let (_, pronated) = app.get(&format!("{uri}?grip=pronation"), &token).await;
    assert_eq!(weights(&pronated), vec![52.5, 50.0]);
    let (_, unknown) = app.get(&format!("{uri}?grip=none"), &token).await;
    assert_eq!(
        weights(&unknown),
        vec![45.0],
        "the history with no grip is a series of its own"
    );

    let (_, last_time) = app
        .get(
            &format!(
                "{uri}?mode=reps&equipment=cable&grip=pronation&beforeWorkoutId={}&perPage=1",
                workouts[3]
            ),
            &token,
        )
        .await;
    assert_eq!(last_time["total"], 1);
    assert_eq!(
        last_time["items"][0]["performedOn"], "2026-10-08",
        "skips the supinated session in between"
    );

    let (status, _) = app.get(&format!("{uri}?grip=hook"), &token).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn logged_grips_cannot_be_removed(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let edit = |grips: Value, default_grip: Value| {
        json!({
            "names": { "fr": "Tirage menton" }, "modes": ["reps"], "defaultMode": "reps",
            "load": "required", "equipment": ["cable"], "defaultEquipment": "cable",
            "grips": grips, "defaultGrip": default_grip, "unilateral": false
        })
    };
    let (_, custom) = app
        .post(
            "/v1/exercises",
            &token,
            edit(
                json!(["pronation", "supination", "neutral"]),
                json!("pronation"),
            ),
        )
        .await;
    let id = custom["id"].as_str().unwrap();
    let uri = format!("/v1/exercises/{id}");
    let workout = new_workout(&app, &token, "2026-10-22").await;
    for grip in [json!("supination"), Value::Null] {
        let (status, _) = app
            .post(
                &format!("/v1/workouts/{workout}/blocks"),
                &token,
                json!({ "exercises": [{ "exerciseId": id, "grip": grip, "sets": [
                    { "round": 1, "reps": 12, "weightKg": 20.0 }
                ]}]}),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED);
    }
    let (status, template) = app
        .post(
            "/v1/templates",
            &token,
            json!({ "name": "Épaules", "blocks": [{ "exercises": [
                { "exerciseId": id, "grip": "neutral", "target": "12" },
                { "exerciseId": id, "grip": "supination" }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let template_uri = format!("/v1/templates/{}", template["id"].as_str().unwrap());

    for grips in [json!(["pronation", "neutral"]), json!([])] {
        let default_grip = grips[0].clone();
        let (status, problem) = app.put(&uri, &token, edit(grips, default_grip)).await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(problem["type"], "urn:repsheet:problem:grip-locked");
    }

    let (status, updated) = app
        .put(
            &uri,
            &token,
            edit(json!(["supination"]), json!("supination")),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "pronation and neutral were never logged, and a block without a grip locks none"
    );
    assert_eq!(updated["grips"], json!(["supination"]));
    let (_, planned) = app.get(&template_uri, &token).await;
    let grips: Vec<&Value> = planned["blocks"][0]["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| &e["grip"])
        .collect();
    assert_eq!(
        grips,
        vec![&json!("supination"), &json!("supination")],
        "a removed grip falls back on the default one"
    );
    assert_eq!(planned["blocks"][0]["exercises"][0]["target"], "12");

    let (_, unlogged) = app
        .post(
            "/v1/exercises",
            &token,
            json!({
                "names": { "fr": "Rowing T" }, "modes": ["reps"], "defaultMode": "reps",
                "load": "required", "equipment": ["barbell"], "defaultEquipment": "barbell",
                "grips": ["neutral"], "defaultGrip": "neutral"
            }),
        )
        .await;
    let unlogged_id = unlogged["id"].as_str().unwrap();
    let (status, _) = app
        .put(
            &template_uri,
            &token,
            json!({ "name": "Épaules", "blocks": [{ "exercises": [
                { "exerciseId": unlogged_id, "grip": "neutral" }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = app
        .put(
            &format!("/v1/exercises/{unlogged_id}"),
            &token,
            json!({
                "names": { "fr": "Rowing T" }, "modes": ["reps"], "defaultMode": "reps",
                "load": "required", "equipment": ["barbell"], "defaultEquipment": "barbell",
                "unilateral": false
            }),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "an update without grips does not clear them"
    );
    let (status, _) = app
        .put(
            &format!("/v1/exercises/{unlogged_id}"),
            &token,
            json!({
                "names": { "fr": "Rowing T" }, "modes": ["reps"], "defaultMode": "reps",
                "load": "required", "equipment": ["barbell"], "defaultEquipment": "barbell",
                "grips": [], "unilateral": false
            }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, planned) = app.get(&template_uri, &token).await;
    assert_eq!(
        planned["blocks"][0]["exercises"][0]["grip"],
        Value::Null,
        "with no grip left, a template exercise holds none"
    );
}

/// Runs the migrations up to `version`, the state of a database deployed then.
async fn migrate_to(pool: &PgPool, version: i64) {
    repsheet_api::MIGRATOR.run_to(version, pool).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn merges_the_barbell_and_dumbbell_variants_of_the_catalog(pool: PgPool) {
    migrate_to(&pool, 1).await;
    let app = TestApp::new(pool.clone());
    let token = app.sign_up("alex@example.com").await;
    let user_id = app.user_id(&token).await;
    let workout = new_workout(&app, &token, "2026-10-22").await;
    sqlx::query(
        "WITH b AS (
            INSERT INTO blocks (workout_id, position) VALUES ($1::UUID, 1) RETURNING id
        ),
        be AS (
            INSERT INTO block_exercises (block_id, position, exercise_id, mode)
            SELECT b.id, 1, e.id, 'reps' FROM b, exercises AS e
            WHERE e.name_fr = 'Curl biceps haltères'
            RETURNING id
        )
        INSERT INTO workout_sets (block_exercise_id, round, reps, weight_kg)
        SELECT be.id, 1, 10, 14 FROM be",
    )
    .bind(&workout)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "WITH t AS (
            INSERT INTO templates (user_id, name) VALUES ($1::UUID, 'Bras') RETURNING id
        ),
        tb AS (
            INSERT INTO template_blocks (template_id, position) SELECT t.id, 1 FROM t RETURNING id
        )
        INSERT INTO template_block_exercises (template_block_id, position, exercise_id, mode)
        SELECT tb.id, 1, e.id, 'reps' FROM tb, exercises AS e
        WHERE e.name_fr IN ('Développé épaules haltères', 'Squat')",
    )
    .bind(&user_id)
    .execute(&pool)
    .await
    .unwrap();

    repsheet_api::MIGRATOR.run(&pool).await.unwrap();

    let (_, logged) = app.get(&format!("/v1/workouts/{workout}"), &token).await;
    let curl = &logged["blocks"][0]["exercises"][0];
    assert_eq!(curl["exercise"]["name"], "Curl biceps");
    assert_eq!(
        curl["exercise"]["equipment"],
        json!(["barbell", "dumbbell"])
    );
    assert_eq!(curl["equipment"], "dumbbell");
    assert_eq!(curl["sets"][0]["weightKg"], 14.0);

    let curl_id = curl["exercise"]["id"].as_str().unwrap();
    let (_, dumbbell) = app
        .get(
            &format!("/v1/exercises/{curl_id}/performances?equipment=dumbbell"),
            &token,
        )
        .await;
    assert_eq!(dumbbell["total"], 1);

    let (_, templates) = app.get("/v1/templates", &token).await;
    let template_id = templates["items"][0]["id"].as_str().unwrap();
    let (_, template) = app
        .get(&format!("/v1/templates/{template_id}"), &token)
        .await;
    let mut planned: Vec<(&str, &str)> = template["blocks"][0]["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["exercise"]["name"].as_str().unwrap(),
                e["equipment"].as_str().unwrap(),
            )
        })
        .collect();
    planned.sort_unstable();
    assert_eq!(
        planned,
        vec![("Développé militaire", "dumbbell"), ("Squat", "barbell")]
    );

    let (_, catalog) = app.get("/v1/exercises?q=halt", &token).await;
    let names: Vec<&str> = catalog["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        vec!["Écarté haltères", "Rowing haltère"],
        "the one-arm row stays a movement of its own"
    );
    let (_, curls) = app.get("/v1/exercises?q=curl%20biceps", &token).await;
    assert_eq!(curls["total"], 1);
}

#[sqlx::test(migrations = false)]
async fn merges_the_hammer_curl_into_the_biceps_curl(pool: PgPool) {
    migrate_to(&pool, 2).await;
    let app = TestApp::new(pool.clone());
    let token = app.sign_up("alex@example.com").await;
    let user_id = app.user_id(&token).await;
    let workout = new_workout(&app, &token, "2026-10-22").await;
    sqlx::query(
        "WITH b AS (
            INSERT INTO blocks (workout_id, position) VALUES ($1::UUID, 1) RETURNING id
        ),
        be AS (
            INSERT INTO block_exercises (block_id, position, exercise_id, mode, equipment)
            SELECT b.id, v.position, e.id, 'reps', v.equipment
            FROM b
            CROSS JOIN (VALUES ('Curl biceps', 1, 'barbell'), ('Curl marteau', 2, 'dumbbell'))
                AS v (name, position, equipment)
            INNER JOIN exercises AS e ON e.name_fr = v.name
            RETURNING id, position
        )
        INSERT INTO workout_sets (block_exercise_id, round, reps, weight_kg)
        SELECT be.id, 1, 10, 10 + be.position FROM be",
    )
    .bind(&workout)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "WITH t AS (
            INSERT INTO templates (user_id, name) VALUES ($1::UUID, 'Bras') RETURNING id
        ),
        tb AS (
            INSERT INTO template_blocks (template_id, position) SELECT t.id, 1 FROM t RETURNING id
        )
        INSERT INTO template_block_exercises
            (template_block_id, position, exercise_id, mode, equipment)
        SELECT tb.id, 1, e.id, 'reps', 'dumbbell' FROM tb, exercises AS e
        WHERE e.name_fr = 'Curl marteau'",
    )
    .bind(&user_id)
    .execute(&pool)
    .await
    .unwrap();

    repsheet_api::MIGRATOR.run(&pool).await.unwrap();

    let (status, logged) = app.get(&format!("/v1/workouts/{workout}"), &token).await;
    assert_eq!(status, StatusCode::OK);
    let block = &logged["blocks"][0];
    let curls: Vec<(&str, &str, &Value)> = block["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["exercise"]["name"].as_str().unwrap(),
                e["equipment"].as_str().unwrap(),
                &e["grip"],
            )
        })
        .collect();
    assert_eq!(
        curls,
        vec![
            ("Curl biceps", "barbell", &Value::Null),
            ("Curl biceps", "dumbbell", &json!("neutral")),
        ],
        "the same exercise twice in one block"
    );
    assert_ne!(
        block["exercises"][0]["id"], block["exercises"][1]["id"],
        "each block exercise has an id of its own"
    );
    let curl_id = block["exercises"][0]["exercise"]["id"].as_str().unwrap();
    assert_eq!(
        block["exercises"][1]["exercise"]["grips"],
        json!(["pronation", "supination", "neutral"])
    );

    let uri = format!("/v1/exercises/{curl_id}/performances");
    let (_, hammer) = app.get(&format!("{uri}?grip=neutral"), &token).await;
    assert_eq!(hammer["total"], 1);
    assert_eq!(hammer["items"][0]["sets"][0]["weightKg"], 12.0);
    assert_eq!(
        hammer["items"][0]["blockExerciseId"],
        block["exercises"][1]["id"]
    );
    let (_, unknown) = app.get(&format!("{uri}?grip=none"), &token).await;
    assert_eq!(unknown["total"], 1);

    let (status, _) = app
        .put(
            &format!(
                "/v1/workouts/{workout}/blocks/{}",
                block["id"].as_str().unwrap()
            ),
            &token,
            json!({ "exercises": [
                { "exerciseId": curl_id, "equipment": "barbell", "grip": "supination", "sets": [
                    { "round": 1, "reps": 10, "weightKg": 11.0 }
                ]},
                { "exerciseId": curl_id, "equipment": "dumbbell", "grip": "neutral", "sets": [
                    { "round": 1, "reps": 10, "weightKg": 12.0 }
                ]}
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    let (_, templates) = app.get("/v1/templates", &token).await;
    let template_id = templates["items"][0]["id"].as_str().unwrap();
    let (_, template) = app
        .get(&format!("/v1/templates/{template_id}"), &token)
        .await;
    let planned = &template["blocks"][0]["exercises"][0];
    assert!(planned["id"].is_string());
    assert_eq!(planned["exercise"]["id"], curl_id);
    assert_eq!(planned["equipment"], "dumbbell");
    assert_eq!(planned["grip"], "neutral");

    let (_, hammers) = app.get("/v1/exercises?q=marteau", &token).await;
    assert_eq!(hammers["total"], 0);
    let deadlift = app.exercise_id(&token, "Soulevé de terre").await;
    let (_, deadlift) = app.get(&format!("/v1/exercises/{deadlift}"), &token).await;
    assert_eq!(deadlift["grips"], json!(["pronation", "mixed"]));
}

#[sqlx::test(migrations = false)]
async fn leaves_a_renamed_hammer_curl_alone(pool: PgPool) {
    migrate_to(&pool, 2).await;
    sqlx::query(
        "UPDATE exercises SET name_fr = 'Curl prise neutre' WHERE name_fr = 'Curl marteau'",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE exercises SET name_fr = 'Traction' WHERE name_fr = 'Tractions'")
        .execute(&pool)
        .await
        .unwrap();

    repsheet_api::MIGRATOR.run(&pool).await.unwrap();

    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let hammer = app.exercise_id(&token, "Curl prise neutre").await;
    let (_, hammer) = app.get(&format!("/v1/exercises/{hammer}"), &token).await;
    assert_eq!(hammer["grips"], json!([]));
    let pull_up = app.exercise_id(&token, "Traction").await;
    let (_, pull_up) = app.get(&format!("/v1/exercises/{pull_up}"), &token).await;
    assert_eq!(pull_up["grips"], json!([]), "renamed, so left as it is");
}

#[sqlx::test(migrations = false)]
async fn sessions_planned_before_drafts_stay_visible(pool: PgPool) {
    migrate_to(&pool, 6).await;
    let app = TestApp::new(pool.clone());
    let (athlete, coach, athlete_id) = coached_athlete(&app).await;
    let coach_id = app.user_id(&coach).await;
    let template_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO templates (user_id, name, planned_on, author_id) \
         VALUES ($1::UUID, 'Upper push', '2026-11-12', $2::UUID) RETURNING id",
    )
    .bind(&athlete_id)
    .bind(&coach_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "WITH b AS (INSERT INTO template_blocks (template_id, position, rounds) \
         VALUES ($1, 1, 3) RETURNING id) \
         INSERT INTO template_block_exercises (template_block_id, position, exercise_id, mode, \
         equipment, target) SELECT b.id, 1, e.id, 'reps', 'barbell', '5×5' FROM b, exercises e \
         WHERE e.name_fr = 'Développé couché'",
    )
    .bind(template_id)
    .execute(&pool)
    .await
    .unwrap();

    repsheet_api::MIGRATOR.run(&pool).await.unwrap();

    let (status, kept) = app
        .get(&format!("/v1/planned-sessions/{template_id}"), &athlete)
        .await;
    assert_eq!(status, StatusCode::OK, "{kept}");
    assert_eq!(kept["status"], "sent");
    let exercise = &kept["blocks"][0]["exercises"][0];
    assert_eq!(
        exercise["target"], "5×5",
        "planned with a target, still read"
    );
    assert_eq!(exercise["sets"], json!([]));
}

/// Signs up an athlete and a coach the athlete adds; returns their tokens and
/// the athlete's id.
async fn coached_athlete(app: &TestApp) -> (String, String, String) {
    let athlete = app.sign_up("paul@example.com").await;
    let coach = app.sign_up("marie@example.com").await;
    let (status, _) = app
        .post(
            "/v1/users/me/coaches",
            &athlete,
            json!({ "email": "marie@example.com" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let athlete_id = app.user_id(&athlete).await;
    (athlete, coach, athlete_id)
}

/// Three rounds of 5 reps at `weight` kg.
fn five_by(weight: f64) -> Value {
    json!([
        { "round": 1, "reps": 5, "weightKg": weight },
        { "round": 2, "reps": 5, "weightKg": weight },
        { "round": 3, "reps": 5, "weightKg": weight }
    ])
}

/// Starts a draft session for `athlete_id`; returns the response.
async fn draft_session(app: &TestApp, coach: &str, athlete_id: &str) -> (StatusCode, Value) {
    app.post(
        "/v1/planned-sessions",
        coach,
        json!({
            "athleteId": athlete_id,
            "plannedOn": "2026-11-12",
            "name": "Upper push",
            "note": "Keep 2 reps in reserve"
        }),
    )
    .await
}

/// Plans a one-block bench session for `athlete_id` and sends it; returns
/// the creation's status and, when it succeeded, the session as sent.
async fn plan_session(app: &TestApp, coach: &str, athlete_id: &str) -> (StatusCode, Value) {
    let (status, draft) = draft_session(app, coach, athlete_id).await;
    if status != StatusCode::CREATED {
        return (status, draft);
    }
    let bench = app.exercise_id(coach, "Développé couché").await;
    let session_uri = format!("/v1/planned-sessions/{}", draft["id"].as_str().unwrap());
    let (status, block) = app
        .post(
            &format!("{session_uri}/blocks"),
            coach,
            json!({ "exercises": [{ "exerciseId": bench, "sets": five_by(60.0) }] }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{block}");
    let (status, sent) = app
        .put(
            &format!("{session_uri}/status"),
            coach,
            json!({ "status": "sent" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    (StatusCode::CREATED, sent)
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn athletes_add_and_remove_their_coaches(pool: PgPool) {
    let app = TestApp::new(pool);
    let athlete = app.sign_up("paul@example.com").await;
    let coach = app.sign_up("marie@example.com").await;
    let coach_id = app.user_id(&coach).await;
    let athlete_id = app.user_id(&athlete).await;

    let (status, added) = app
        .post(
            "/v1/users/me/coaches",
            &athlete,
            json!({ "email": "Marie@Example.com" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{added}");
    assert_eq!(added["id"], coach_id.as_str());
    assert_eq!(added["email"], "marie@example.com");

    let (_, coaches) = app.get("/v1/users/me/coaches", &athlete).await;
    assert_eq!(coaches["total"], 1);
    let (_, athletes) = app.get("/v1/users/me/athletes", &coach).await;
    assert_eq!(athletes["items"][0]["id"], athlete_id.as_str());
    let athlete_uri = format!("/v1/users/me/athletes/{athlete_id}");
    assert_eq!(app.get(&athlete_uri, &coach).await.0, StatusCode::OK);
    let (_, none) = app.get("/v1/users/me/athletes", &athlete).await;
    assert_eq!(none["total"], 0, "the link goes one way");

    let (status, problem) = app
        .post(
            "/v1/users/me/coaches",
            &athlete,
            json!({ "email": "marie@example.com" }),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(problem["type"], "urn:repsheet:problem:coach-already-added");

    for (email, kind) in [
        ("nobody@example.com", "unknown-account"),
        ("paul@example.com", "own-coach"),
    ] {
        let (status, problem) = app
            .post("/v1/users/me/coaches", &athlete, json!({ "email": email }))
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{email}");
        assert_eq!(problem["type"], format!("urn:repsheet:problem:{kind}"));
    }

    let coach_uri = format!("/v1/users/me/coaches/{coach_id}");
    assert_eq!(app.get(&coach_uri, &athlete).await.0, StatusCode::OK);
    assert_eq!(
        app.delete(&coach_uri, &athlete).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.delete(&coach_uri, &athlete).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(app.get(&coach_uri, &athlete).await.0, StatusCode::NOT_FOUND);
    assert_eq!(app.get(&athlete_uri, &coach).await.0, StatusCode::NOT_FOUND);
    let (_, athletes) = app.get("/v1/users/me/athletes", &coach).await;
    assert_eq!(athletes["total"], 0);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn coaches_plan_sessions_and_read_how_they_went(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach, athlete_id) = coached_athlete(&app).await;

    let (status, planned) = plan_session(&app, &coach, &athlete_id).await;
    assert_eq!(status, StatusCode::CREATED, "{planned}");
    assert_eq!(planned["athleteId"], athlete_id.as_str());
    assert_eq!(planned["plannedOn"], "2026-11-12");
    assert_eq!(planned["author"]["id"], app.user_id(&coach).await.as_str());
    assert_eq!(planned["status"], "sent");
    assert_eq!(planned["blocks"][0]["rounds"], 3);
    let planned_sets = &planned["blocks"][0]["exercises"][0]["sets"];
    assert_eq!(planned_sets.as_array().unwrap().len(), 3);
    assert_eq!(planned_sets[2]["weightKg"], 60.0);
    let session_id = planned["id"].as_str().unwrap();
    let block_id = planned["blocks"][0]["id"].as_str().unwrap();
    let bench = planned["blocks"][0]["exercises"][0]["exercise"]["id"].clone();

    let (_, mine) = app.get("/v1/planned-sessions", &athlete).await;
    assert_eq!(mine["total"], 1);
    assert_eq!(mine["items"][0]["author"]["name"], "Alex");
    assert_eq!(mine["items"][0]["workoutCount"], 0);
    let (_, library) = app.get("/v1/templates", &athlete).await;
    assert_eq!(
        library["total"], 0,
        "planned sessions stay out of the library"
    );
    let (status, as_template) = app
        .get(&format!("/v1/templates/{session_id}"), &athlete)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(as_template["blocks"][0]["id"], block_id);
    assert_eq!(as_template["author"]["name"], "Alex");
    assert_eq!(
        as_template["blocks"][0]["exercises"][0]["sets"][0]["reps"],
        5
    );

    let (status, workout) = app
        .post(
            "/v1/workouts",
            &athlete,
            json!({ "name": "Upper push", "templateId": session_id, "performedOn": "2026-11-12" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let workout_id = workout["id"].as_str().unwrap();
    let (status, _) = app
        .post(
            &format!("/v1/workouts/{workout_id}/blocks"),
            &athlete,
            json!({ "templateBlockId": block_id, "exercises": [{ "exerciseId": bench, "sets": [
                { "round": 1, "reps": 5, "weightKg": 80.0 },
                { "round": 2, "reps": 4, "weightKg": 80.0 }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);

    let athlete_query = format!("/v1/planned-sessions?athleteId={athlete_id}");
    let (status, planned_for) = app.get(&athlete_query, &coach).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(planned_for["items"][0]["workoutCount"], 1);
    let workouts_uri = format!("/v1/planned-sessions/{session_id}/workouts");
    let (status, outcome) = app.get(&workouts_uri, &coach).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(outcome["total"], 1);
    let logged = &outcome["items"][0]["blocks"][0];
    assert_eq!(logged["templateBlockId"], block_id);
    assert_eq!(logged["exercises"][0]["sets"][1]["reps"], 4);
    assert_eq!(logged["exercises"][0]["sets"][1]["weightKg"], 80.0);

    let session_uri = format!("/v1/planned-sessions/{session_id}");
    let (status, updated) = app
        .put(
            &session_uri,
            &coach,
            json!({ "plannedOn": "2026-11-13", "name": "Upper push" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["plannedOn"], "2026-11-13");
    assert_eq!(
        updated["blocks"][0]["id"], block_id,
        "blocks are left untouched"
    );
    assert!(updated["note"].is_null());

    let (_, custom) = app
        .post(
            "/v1/exercises",
            &coach,
            json!({ "names": { "fr": "Pompes lestées" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": ["other"], "defaultEquipment": "other", "grips": [] }),
        )
        .await;
    let (status, problem) = app
        .post(
            &format!("{session_uri}/blocks"),
            &coach,
            json!({ "exercises": [{ "exerciseId": custom["id"], "sets": five_by(10.0) }] }),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "the athlete cannot use the coach's exercises"
    );
    assert_eq!(field_paths(&problem), vec!["exercises[0].exerciseId"]);

    assert_eq!(
        app.delete(&session_uri, &athlete).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.get(&session_uri, &athlete).await.0,
        StatusCode::NOT_FOUND
    );
    let (_, workout) = app
        .get(&format!("/v1/workouts/{workout_id}"), &athlete)
        .await;
    assert!(workout["templateId"].is_null(), "the workout is kept");
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn non_coaches_can_neither_plan_nor_read(pool: PgPool) {
    let app = TestApp::new(pool);
    let (_athlete, coach, athlete_id) = coached_athlete(&app).await;
    let stranger = app.sign_up("sam@example.com").await;
    let (_, planned) = plan_session(&app, &coach, &athlete_id).await;
    let session_uri = format!("/v1/planned-sessions/{}", planned["id"].as_str().unwrap());

    for athlete in [athlete_id.as_str(), "00000000-0000-0000-0000-000000000000"] {
        let (status, problem) = plan_session(&app, &stranger, athlete).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{athlete}");
        assert_eq!(problem["type"], "urn:repsheet:problem:not-coach");
        let (status, _) = app
            .get(
                &format!("/v1/planned-sessions?athleteId={athlete}"),
                &stranger,
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{athlete}");
    }
    assert_eq!(
        app.get(&session_uri, &stranger).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.get(&format!("{session_uri}/workouts"), &stranger)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let (status, _) = app
        .put(
            &session_uri,
            &stranger,
            json!({ "plannedOn": "2026-11-13", "name": "Hijacked" }),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        app.delete(&session_uri, &stranger).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.get(&session_uri, &coach).await.0,
        StatusCode::OK,
        "still there"
    );
    let (_, own) = app.get("/v1/planned-sessions", &stranger).await;
    assert_eq!(own["total"], 0);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn revoked_coaches_lose_access_and_the_athlete_keeps_the_sessions(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach, athlete_id) = coached_athlete(&app).await;
    let coach_id = app.user_id(&coach).await;
    let (_, planned) = plan_session(&app, &coach, &athlete_id).await;
    let session_uri = format!("/v1/planned-sessions/{}", planned["id"].as_str().unwrap());
    assert_eq!(app.get(&session_uri, &coach).await.0, StatusCode::OK);

    assert_eq!(
        app.delete(&format!("/v1/users/me/coaches/{coach_id}"), &athlete)
            .await,
        StatusCode::NO_CONTENT
    );

    let (status, problem) = plan_session(&app, &coach, &athlete_id).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(problem["type"], "urn:repsheet:problem:not-coach");
    let (status, _) = app
        .get(
            &format!("/v1/planned-sessions?athleteId={athlete_id}"),
            &coach,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(app.get(&session_uri, &coach).await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        app.get(&format!("{session_uri}/workouts"), &coach).await.0,
        StatusCode::NOT_FOUND
    );
    let (status, _) = app
        .put(
            &session_uri,
            &coach,
            json!({ "plannedOn": "2026-11-13", "name": "Too late" }),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        app.delete(&session_uri, &coach).await,
        StatusCode::NO_CONTENT
    );

    let (status, kept) = app.get(&session_uri, &athlete).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(kept["name"], "Upper push");
    assert_eq!(kept["author"]["id"], coach_id.as_str());
    let (_, mine) = app.get("/v1/planned-sessions", &athlete).await;
    assert_eq!(mine["total"], 1);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn planned_sessions_outlive_their_author(pool: PgPool) {
    let app = TestApp::new(pool);
    let admin = app.super_admin().await;
    let (athlete, coach, athlete_id) = coached_athlete(&app).await;
    let coach_id = app.user_id(&coach).await;
    let (_, planned) = plan_session(&app, &coach, &athlete_id).await;

    assert_eq!(
        app.delete(&format!("/v1/users/{coach_id}"), &admin).await,
        StatusCode::NO_CONTENT
    );

    let (status, kept) = app
        .get(
            &format!("/v1/planned-sessions/{}", planned["id"].as_str().unwrap()),
            &athlete,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(kept["author"].is_null());
    let (_, coaches) = app.get("/v1/users/me/coaches", &athlete).await;
    assert_eq!(coaches["total"], 0);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn each_coach_reads_only_the_sessions_they_planned(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach_a, athlete_id) = coached_athlete(&app).await;
    let coach_b = app.sign_up("thomas@example.com").await;
    let (status, _) = app
        .post(
            "/v1/users/me/coaches",
            &athlete,
            json!({ "email": "thomas@example.com" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let (_, coaches) = app.get("/v1/users/me/coaches", &athlete).await;
    assert_eq!(coaches["total"], 2);

    let (_, plan_a) = plan_session(&app, &coach_a, &athlete_id).await;
    let (_, plan_b) = plan_session(&app, &coach_b, &athlete_id).await;
    let (_, own_template) = app
        .post(
            "/v1/templates",
            &athlete,
            json!({ "name": "Mine", "blocks": [] }),
        )
        .await;
    let mut workouts = Vec::new();
    for template in [
        &plan_a["id"],
        &plan_b["id"],
        &own_template["id"],
        &Value::Null,
    ] {
        let (status, workout) = app
            .post(
                "/v1/workouts",
                &athlete,
                json!({ "name": "Session", "templateId": template, "performedOn": "2026-11-12" }),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED);
        workouts.push(workout["id"].as_str().unwrap().to_owned());
    }
    let [from_a, from_b, from_own, free] = workouts.as_slice() else {
        panic!("four workouts expected");
    };

    let (_, mine) = app.get("/v1/planned-sessions", &athlete).await;
    assert_eq!(mine["total"], 2, "the athlete sees every coach's plans");

    for (coach, own_plan, other_plan, own_outcome, other_outcome) in [
        (&coach_a, &plan_a, &plan_b, from_a, from_b),
        (&coach_b, &plan_b, &plan_a, from_b, from_a),
    ] {
        let (_, listed) = app
            .get(
                &format!("/v1/planned-sessions?athleteId={athlete_id}"),
                coach,
            )
            .await;
        assert_eq!(listed["total"], 1);
        assert_eq!(listed["items"][0]["id"], own_plan["id"]);

        let own_uri = format!("/v1/planned-sessions/{}", own_plan["id"].as_str().unwrap());
        let (_, outcome) = app.get(&format!("{own_uri}/workouts"), coach).await;
        assert_eq!(outcome["total"], 1);
        assert_eq!(outcome["items"][0]["id"], own_outcome.as_str());

        let other_uri = format!(
            "/v1/planned-sessions/{}",
            other_plan["id"].as_str().unwrap()
        );
        assert_eq!(app.get(&other_uri, coach).await.0, StatusCode::NOT_FOUND);
        assert_eq!(
            app.get(&format!("{other_uri}/workouts"), coach).await.0,
            StatusCode::NOT_FOUND
        );
        let (status, _) = app
            .put(
                &other_uri,
                coach,
                json!({ "plannedOn": "2026-11-13", "name": "Mine now" }),
            )
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(app.delete(&other_uri, coach).await, StatusCode::NO_CONTENT);
        assert_eq!(app.get(&other_uri, &athlete).await.0, StatusCode::OK);

        for workout in [other_outcome, from_own, free] {
            assert_eq!(
                app.get(&format!("/v1/workouts/{workout}"), coach).await.0,
                StatusCode::NOT_FOUND,
                "neither planned by this coach nor shared with them"
            );
        }
        assert_eq!(
            app.get(&format!("/v1/workouts/{own_outcome}"), coach)
                .await
                .0,
            StatusCode::OK
        );
        let other_template = other_plan["id"].as_str().unwrap();
        for template in [other_template, own_template["id"].as_str().unwrap()] {
            assert_eq!(
                app.get(&format!("/v1/templates/{template}"), coach).await.0,
                StatusCode::NOT_FOUND
            );
        }
        let (_, coach_workouts) = app.get("/v1/workouts", coach).await;
        assert_eq!(coach_workouts["total"], 0);
    }
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn athletes_share_workouts_with_one_coach_at_a_time(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach, athlete_id) = coached_athlete(&app).await;
    let other_coach = app.sign_up("thomas@example.com").await;
    app.post(
        "/v1/users/me/coaches",
        &athlete,
        json!({ "email": "thomas@example.com" }),
    )
    .await;
    let coach_id = app.user_id(&coach).await;
    let stranger = app.sign_up("sam@example.com").await;
    let stranger_id = app.user_id(&stranger).await;
    let workout = new_workout(&app, &athlete, "2026-11-10").await;
    let squat = app.exercise_id(&athlete, "Squat").await;
    app.post(
        &format!("/v1/workouts/{workout}/blocks"),
        &athlete,
        json!({ "exercises": [{ "exerciseId": squat, "sets": [{ "round": 1, "reps": 5, "weightKg": 100.0 }] }] }),
    )
    .await;
    let workout_uri = format!("/v1/workouts/{workout}");
    let share_uri = format!("{workout_uri}/shares/{coach_id}");
    let shared_list = format!("/v1/workouts?athleteId={athlete_id}");

    assert_eq!(app.get(&workout_uri, &coach).await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        app.put(&share_uri, &athlete, json!(null)).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.put(&share_uri, &athlete, json!(null)).await.0,
        StatusCode::NO_CONTENT,
        "sharing again changes nothing"
    );
    let (_, shares) = app.get(&format!("{workout_uri}/shares"), &athlete).await;
    assert_eq!(shares["total"], 1);
    assert_eq!(shares["items"][0]["coachId"], coach_id.as_str());

    let (status, read) = app.get(&workout_uri, &coach).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        read["blocks"][0]["exercises"][0]["sets"][0]["weightKg"],
        100.0
    );
    let (_, listed) = app.get(&shared_list, &coach).await;
    assert_eq!(listed["total"], 1);
    assert_eq!(listed["items"][0]["id"], workout.as_str());
    assert_eq!(
        app.get(&workout_uri, &other_coach).await.0,
        StatusCode::NOT_FOUND
    );
    let (_, nothing) = app.get(&shared_list, &other_coach).await;
    assert_eq!(nothing["total"], 0);
    assert_eq!(
        app.get(&shared_list, &stranger).await.0,
        StatusCode::FORBIDDEN
    );
    let (status, _) = app
        .put(&format!("/v1/workouts/{workout}/blocks/{}", read["blocks"][0]["id"].as_str().unwrap()), &coach, json!({ "exercises": [{ "exerciseId": squat, "sets": [{ "round": 1, "reps": 1, "weightKg": 1.0 }] }] }))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "sharing is read-only");
    assert_eq!(
        app.delete(&workout_uri, &coach).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(app.get(&workout_uri, &athlete).await.0, StatusCode::OK);

    assert_eq!(
        app.put(
            &format!("{workout_uri}/shares/{stranger_id}"),
            &athlete,
            json!(null)
        )
        .await
        .0,
        StatusCode::NOT_FOUND,
        "only a coach of the athlete"
    );
    assert_eq!(
        app.put(&share_uri, &other_coach, json!(null)).await.0,
        StatusCode::NOT_FOUND,
        "only the owner shares"
    );

    assert_eq!(
        app.delete(&share_uri, &athlete).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(app.get(&workout_uri, &coach).await.0, StatusCode::NOT_FOUND);
    let (_, listed) = app.get(&shared_list, &coach).await;
    assert_eq!(listed["total"], 0);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn removing_a_coach_removes_their_shares_for_good(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach, athlete_id) = coached_athlete(&app).await;
    let coach_id = app.user_id(&coach).await;
    let workout = new_workout(&app, &athlete, "2026-11-10").await;
    let workout_uri = format!("/v1/workouts/{workout}");
    app.put(
        &format!("{workout_uri}/shares/{coach_id}"),
        &athlete,
        json!(null),
    )
    .await;
    assert_eq!(app.get(&workout_uri, &coach).await.0, StatusCode::OK);

    let coach_uri = format!("/v1/users/me/coaches/{coach_id}");
    assert_eq!(
        app.delete(&coach_uri, &athlete).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(app.get(&workout_uri, &coach).await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        app.get(&format!("/v1/workouts?athleteId={athlete_id}"), &coach)
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    let (status, _) = app
        .post(
            "/v1/users/me/coaches",
            &athlete,
            json!({ "email": "marie@example.com" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        app.get(&workout_uri, &coach).await.0,
        StatusCode::NOT_FOUND,
        "a new link starts with nothing shared"
    );
    let (_, shares) = app.get(&format!("{workout_uri}/shares"), &athlete).await;
    assert_eq!(shares["total"], 0);
    let (_, listed) = app
        .get(&format!("/v1/workouts?athleteId={athlete_id}"), &coach)
        .await;
    assert_eq!(listed["total"], 0);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn planned_sessions_plan_the_grip(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach, athlete_id) = coached_athlete(&app).await;
    let pull_up = app.exercise_id(&coach, "Tractions").await;
    let (_, draft) = draft_session(&app, &coach, &athlete_id).await;
    let session_uri = format!("/v1/planned-sessions/{}", draft["id"].as_str().unwrap());
    let sets = json!([{ "round": 1, "reps": 6 }]);

    let (status, block) = app
        .post(
            &format!("{session_uri}/blocks"),
            &coach,
            json!({ "exercises": [
                { "exerciseId": pull_up, "grip": "supination", "sets": sets },
                { "exerciseId": pull_up, "sets": sets }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{block}");
    assert_eq!(block["kind"], "superset");
    assert_eq!(block["exercises"][0]["grip"], "supination");
    assert!(
        block["exercises"][1]["grip"].is_null(),
        "left to the athlete"
    );

    app.put(
        &format!("{session_uri}/status"),
        &coach,
        json!({ "status": "sent" }),
    )
    .await;
    let (_, as_template) = app
        .get(
            &format!("/v1/templates/{}", draft["id"].as_str().unwrap()),
            &athlete,
        )
        .await;
    assert_eq!(
        as_template["blocks"][0]["exercises"][0]["grip"],
        "supination"
    );

    let (status, problem) = app
        .post(
            &format!("{session_uri}/blocks"),
            &coach,
            json!({ "exercises": [{ "exerciseId": pull_up, "grip": "mixed", "sets": sets }] }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["exercises[0].grip"]);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn templates_give_instructions_per_exercise(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let bench = app.exercise_id(&token, "Développé couché").await;
    let squat = app.exercise_id(&token, "Squat").await;
    let template_body = |bench_note: Value, squat_note: Value| {
        json!({ "name": "Full body", "blocks": [{ "exercises": [
            { "exerciseId": bench, "target": "8", "note": bench_note },
            { "exerciseId": squat, "target": "5", "note": squat_note }
        ]}]})
    };

    let (status, template) = app
        .post(
            "/v1/templates",
            &token,
            template_body(json!(" Tempo 3-1-1 "), json!("")),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let exercises = &template["blocks"][0]["exercises"];
    assert_eq!(exercises[0]["note"], "Tempo 3-1-1");
    assert!(exercises[1]["note"].is_null(), "blank is no note");
    let template_uri = format!("/v1/templates/{}", template["id"].as_str().unwrap());

    let (status, template) = app
        .put(
            &template_uri,
            &token,
            template_body(Value::Null, json!("Prise serrée")),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let exercises = &template["blocks"][0]["exercises"];
    assert!(exercises[0]["note"].is_null());
    assert_eq!(exercises[1]["note"], "Prise serrée");

    let (_, fetched) = app.get(&template_uri, &token).await;
    assert_eq!(fetched["blocks"][0]["exercises"][1]["note"], "Prise serrée");

    let (status, problem) = app
        .put(
            &template_uri,
            &token,
            template_body(Value::Null, json!("x".repeat(2001))),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["blocks[0].exercises[1].note"]);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn planned_notes_start_the_exercise_threads(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach, athlete_id) = coached_athlete(&app).await;
    let coach_id = app.user_id(&coach).await;
    let bench = app.exercise_id(&coach, "Développé couché").await;
    let fly = app.exercise_id(&coach, "Écarté poulie").await;
    let (_, draft) = draft_session(&app, &coach, &athlete_id).await;
    let session_id = draft["id"].as_str().unwrap();
    let session_uri = format!("/v1/planned-sessions/{session_id}");
    let (status, block) = app
        .post(
            &format!("{session_uri}/blocks"),
            &coach,
            json!({ "exercises": [
                { "exerciseId": bench, "note": " Prise serrée ", "sets": five_by(60.0) },
                { "exerciseId": fly, "note": "", "sets": five_by(10.0) }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{block}");
    assert_eq!(block["exercises"][0]["note"], "Prise serrée");
    assert!(block["exercises"][1]["note"].is_null(), "blank is no note");
    app.put(
        &format!("{session_uri}/status"),
        &coach,
        json!({ "status": "sent" }),
    )
    .await;

    let (_, read) = app.get(&session_uri, &athlete).await;
    assert_eq!(read["blocks"][0]["exercises"][0]["note"], "Prise serrée");

    let (_, workout) = app
        .post(
            "/v1/workouts",
            &athlete,
            json!({ "name": "Upper push", "templateId": session_id, "performedOn": "2026-11-12" }),
        )
        .await;
    let (status, logged) = app
        .post(
            &format!("/v1/workouts/{}/blocks", workout["id"].as_str().unwrap()),
            &athlete,
            json!({ "templateBlockId": block["id"], "exercises": [
                { "exerciseId": fly, "sets": five_by(12.5) },
                { "exerciseId": bench, "sets": five_by(62.5) }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{logged}");
    assert_eq!(
        logged["exercises"][0]["comments"],
        json!([]),
        "the fly had no note"
    );
    let thread = &logged["exercises"][1]["comments"];
    assert_eq!(thread.as_array().unwrap().len(), 1, "matched though moved");
    assert_eq!(thread[0]["text"], "Prise serrée");
    assert_eq!(thread[0]["author"]["id"], coach_id.as_str());

    let (status, reply) = app
        .post(
            "/v1/comments",
            &athlete,
            json!({ "blockExerciseId": logged["exercises"][1]["id"], "text": "Ok, coudes serrés" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{reply}");

    let (_, template) = app
        .post(
            "/v1/templates",
            &athlete,
            json!({ "name": "Mine", "blocks": [{ "exercises": [
                { "exerciseId": bench, "note": "Mes notes" }
            ]}]}),
        )
        .await;
    let (_, own) = app
        .post(
            "/v1/workouts",
            &athlete,
            json!({ "name": "Mine", "templateId": template["id"], "performedOn": "2026-11-13" }),
        )
        .await;
    let (_, from_library) = app
        .post(
            &format!("/v1/workouts/{}/blocks", own["id"].as_str().unwrap()),
            &athlete,
            json!({ "templateBlockId": template["blocks"][0]["id"], "exercises": [
                { "exerciseId": bench, "sets": five_by(60.0) }
            ]}),
        )
        .await;
    assert_eq!(
        from_library["exercises"][0]["comments"],
        json!([]),
        "a template's own notes are not comments"
    );
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn drafts_stay_hidden_from_the_athlete_until_sent(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach, athlete_id) = coached_athlete(&app).await;
    let bench = app.exercise_id(&coach, "Développé couché").await;
    let (status, draft) = draft_session(&app, &coach, &athlete_id).await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    assert_eq!(draft["status"], "draft");
    assert_eq!(draft["blocks"], json!([]));
    let session_id = draft["id"].as_str().unwrap();
    let session_uri = format!("/v1/planned-sessions/{session_id}");
    let status_uri = format!("{session_uri}/status");

    let (status, problem) = app
        .put(&status_uri, &coach, json!({ "status": "sent" }))
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "nothing to send");
    assert_eq!(
        problem["type"],
        "urn:repsheet:problem:planned-session-empty"
    );

    let (_, block) = app
        .post(
            &format!("{session_uri}/blocks"),
            &coach,
            json!({ "exercises": [{ "exerciseId": bench, "sets": five_by(60.0) }] }),
        )
        .await;
    let block_id = block["id"].as_str().unwrap();

    let (_, listed) = app
        .get(
            &format!("/v1/planned-sessions?athleteId={athlete_id}"),
            &coach,
        )
        .await;
    assert_eq!(listed["total"], 1, "the coach sees their draft");
    assert_eq!(listed["items"][0]["status"], "draft");
    let (_, mine) = app.get("/v1/planned-sessions", &athlete).await;
    assert_eq!(mine["total"], 0);
    assert_eq!(mine["items"], json!([]));
    assert_eq!(
        app.get(&session_uri, &athlete).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.get(&format!("{session_uri}/workouts"), &athlete)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.get(&format!("/v1/templates/{session_id}"), &athlete)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let (status, problem) = app
        .post(
            "/v1/workouts",
            &athlete,
            json!({ "name": "Upper push", "templateId": session_id, "performedOn": "2026-11-12" }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["templateId"]);
    let free = new_workout(&app, &athlete, "2026-11-12").await;
    let (status, problem) = app
        .post(
            &format!("/v1/workouts/{free}/blocks"),
            &athlete,
            json!({ "templateBlockId": block_id, "exercises": [
                { "exerciseId": bench, "sets": five_by(60.0) }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["templateBlockId"]);
    let (status, _) = app
        .put(
            &session_uri,
            &athlete,
            json!({ "plannedOn": "2026-11-13", "name": "Mine now" }),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .post(
            &format!("{session_uri}/blocks"),
            &athlete,
            json!({ "exercises": [{ "exerciseId": bench, "sets": five_by(60.0) }] }),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        app.put(&status_uri, &athlete, json!({ "status": "sent" }))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    for uri in [
        session_uri.clone(),
        format!("/v1/templates/{session_id}"),
        format!("{session_uri}/blocks/{block_id}"),
    ] {
        assert_eq!(app.delete(&uri, &athlete).await, StatusCode::NO_CONTENT);
    }
    let (_, kept) = app.get(&session_uri, &coach).await;
    assert_eq!(
        kept["blocks"][0]["id"], block_id,
        "the athlete deleted nothing"
    );

    let (status, sent) = app
        .put(&status_uri, &coach, json!({ "status": "sent" }))
        .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    assert_eq!(sent["status"], "sent");
    let (_, mine) = app.get("/v1/planned-sessions", &athlete).await;
    assert_eq!(mine["total"], 1);
    assert_eq!(mine["items"][0]["status"], "sent");
    assert_eq!(app.get(&session_uri, &athlete).await.0, StatusCode::OK);

    let (status, again) = app
        .put(&status_uri, &coach, json!({ "status": "sent" }))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again["status"], "sent");
    let (status, problem) = app
        .put(&status_uri, &coach, json!({ "status": "draft" }))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(problem["type"], "urn:repsheet:problem:planned-session-sent");
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn coaches_plan_blocks_one_by_one(pool: PgPool) {
    let app = TestApp::new(pool);
    let (_athlete, coach, athlete_id) = coached_athlete(&app).await;
    let stranger = app.sign_up("sam@example.com").await;
    let bench = app.exercise_id(&coach, "Développé couché").await;
    let swing = app.exercise_id(&coach, "Kettlebell swing").await;
    let (_, draft) = draft_session(&app, &coach, &athlete_id).await;
    let session_uri = format!("/v1/planned-sessions/{}", draft["id"].as_str().unwrap());
    let blocks_uri = format!("{session_uri}/blocks");

    let (status, first) = app
        .post(
            &blocks_uri,
            &coach,
            json!({ "exercises": [{ "exerciseId": bench, "sets": [
                { "round": 1, "reps": 12, "weightKg": 40.0, "warmup": true },
                { "round": 2, "reps": 8, "weightKg": 60.0 }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    assert_eq!(first["position"], 1);
    assert_eq!(first["rounds"], 2);
    assert_eq!(first["exercises"][0]["sets"][0]["warmup"], true);
    assert!(first["exercises"][0]["target"].is_null());
    let first_uri = format!("{blocks_uri}/{}", first["id"].as_str().unwrap());
    let (status, second) = app
        .post(
            &blocks_uri,
            &coach,
            json!({ "exercises": [{ "exerciseId": swing, "mode": "time", "sets": [
                { "round": 1, "durationSeconds": 40, "weightKg": 16.0 }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{second}");
    assert_eq!(second["position"], 2);
    assert_eq!(second["exercises"][0]["mode"], "time");

    let (status, updated) = app
        .put(
            &first_uri,
            &coach,
            json!({ "exercises": [{ "exerciseId": bench, "sets": five_by(62.5) }] }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["id"], first["id"], "same block");
    assert_eq!(updated["position"], 1, "same place");
    assert_eq!(updated["rounds"], 3);
    assert_eq!(updated["exercises"][0]["sets"][2]["weightKg"], 62.5);

    for (body, field) in [
        (
            json!({ "exercises": [{ "exerciseId": bench, "sets": [{ "round": 1, "reps": 5 }] }] }),
            "exercises[0].sets[0].weightKg",
        ),
        (
            json!({ "exercises": [{ "exerciseId": bench, "sets": [{ "round": 1, "durationSeconds": 30, "weightKg": 60.0 }] }] }),
            "exercises[0].sets[0].reps",
        ),
        (
            json!({ "exercises": [{ "exerciseId": bench, "sets": [] }] }),
            "exercises[0].sets",
        ),
        (json!({ "exercises": [] }), "exercises"),
    ] {
        let (status, problem) = app.put(&first_uri, &coach, body.clone()).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert!(
            field_paths(&problem).iter().any(|f| f == field),
            "{field} in {problem}"
        );
    }

    let second_uri = format!("{blocks_uri}/{}", second["id"].as_str().unwrap());
    let (status, _) = app
        .put(
            &second_uri,
            &stranger,
            json!({ "exercises": [{ "exerciseId": bench, "sets": five_by(60.0) }] }),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        app.delete(&second_uri, &stranger).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.delete(&second_uri, &coach).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.delete(&second_uri, &coach).await,
        StatusCode::NO_CONTENT
    );
    let (status, _) = app
        .put(
            &second_uri,
            &coach,
            json!({ "exercises": [{ "exerciseId": bench, "sets": five_by(60.0) }] }),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "gone");
    let (_, session) = app.get(&session_uri, &coach).await;
    assert_eq!(session["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(session["blocks"][0]["id"], first["id"]);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn planned_sets_never_count_as_performed(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach, athlete_id) = coached_athlete(&app).await;
    let (_, planned) = plan_session(&app, &coach, &athlete_id).await;
    let bench = planned["blocks"][0]["exercises"][0]["exercise"]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let (_, performances) = app
        .get(&format!("/v1/exercises/{bench}/performances"), &athlete)
        .await;
    assert_eq!(performances["total"], 0);
    let (_, exercise) = app.get(&format!("/v1/exercises/{bench}"), &athlete).await;
    assert!(exercise["lastUsedOn"].is_null());
    let (_, recent) = app.get("/v1/exercises?sort=-lastUsedOn", &athlete).await;
    assert!(
        recent["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["lastUsedOn"].is_null()),
        "{recent}"
    );
    let (_, coach_view) = app
        .get(
            &format!("/v1/exercises/{bench}/performances?athleteId={athlete_id}"),
            &coach,
        )
        .await;
    assert_eq!(coach_view["total"], 0);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn coaches_read_the_last_times_they_may_see(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach, athlete_id) = coached_athlete(&app).await;
    let coach_id = app.user_id(&coach).await;
    let stranger = app.sign_up("sam@example.com").await;
    let bench = app.exercise_id(&athlete, "Développé couché").await;
    let (_, planned) = plan_session(&app, &coach, &athlete_id).await;
    let log = |day: &'static str, template: Value, weight: f64| {
        let app = &app;
        let athlete = &athlete;
        let bench = &bench;
        async move {
            let (_, workout) = app
                .post(
                    "/v1/workouts",
                    athlete,
                    json!({ "name": "Push", "templateId": template, "performedOn": day }),
                )
                .await;
            let workout_id = workout["id"].as_str().unwrap().to_owned();
            let (status, _) = app
                .post(
                    &format!("/v1/workouts/{workout_id}/blocks"),
                    athlete,
                    json!({ "exercises": [{ "exerciseId": bench, "sets": five_by(weight) }] }),
                )
                .await;
            assert_eq!(status, StatusCode::CREATED);
            workout_id
        }
    };
    let from_plan = log("2026-11-01", planned["id"].clone(), 60.0).await;
    let shared = log("2026-11-03", Value::Null, 62.5).await;
    let _private = log("2026-11-05", Value::Null, 65.0).await;
    assert_eq!(
        app.send(
            Method::PUT,
            &format!("/v1/workouts/{shared}/shares/{coach_id}"),
            Some(&athlete),
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );

    let uri = format!("/v1/exercises/{bench}/performances?athleteId={athlete_id}");
    let (status, read) = app.get(&uri, &coach).await;
    assert_eq!(status, StatusCode::OK, "{read}");
    assert_eq!(read["total"], 2, "the private workout stays private");
    assert_eq!(read["items"][0]["workoutId"], shared.as_str());
    assert_eq!(read["items"][0]["sets"][0]["weightKg"], 62.5);
    assert_eq!(read["items"][1]["workoutId"], from_plan.as_str());
    let (_, own) = app
        .get(&format!("/v1/exercises/{bench}/performances"), &athlete)
        .await;
    assert_eq!(own["total"], 3);

    let (_, filtered) = app.get(&format!("{uri}&equipment=dumbbell"), &coach).await;
    assert_eq!(filtered["total"], 0);
    let (status, problem) = app
        .get(&format!("{uri}&beforeWorkoutId={shared}"), &coach)
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["beforeWorkoutId"]);

    let (status, problem) = app.get(&uri, &stranger).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(problem["type"], "urn:repsheet:problem:not-coach");
    app.delete(&format!("/v1/users/me/coaches/{coach_id}"), &athlete)
        .await;
    assert_eq!(app.get(&uri, &coach).await.0, StatusCode::FORBIDDEN);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn block_exercises_keep_their_identity_across_updates(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let incline = app.exercise_id(&token, "Développé incliné").await;
    let flyes = app.exercise_id(&token, "Écarté poulie").await;
    let squat = app.exercise_id(&token, "Squat").await;
    let workout = new_workout(&app, &token, "2026-10-22").await;
    let set = |reps: i32| json!([{ "round": 1, "reps": reps, "weightKg": 20.0 }]);
    let (status, block) = app
        .post(
            &format!("/v1/workouts/{workout}/blocks"),
            &token,
            json!({ "exercises": [
                { "exerciseId": incline, "sets": set(10) },
                { "exerciseId": flyes, "sets": set(12) }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let incline_id = block["exercises"][0]["id"].as_str().unwrap().to_owned();
    let flyes_id = block["exercises"][1]["id"].as_str().unwrap().to_owned();
    let block_uri = format!(
        "/v1/workouts/{workout}/blocks/{}",
        block["id"].as_str().unwrap()
    );

    let (status, updated) = app
        .put(
            &block_uri,
            &token,
            json!({ "exercises": [
                { "id": flyes_id, "exerciseId": flyes, "sets": set(15) },
                { "exerciseId": squat, "sets": set(5) }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    let exercises = &updated["exercises"];
    assert_eq!(exercises[0]["id"], flyes_id.as_str(), "kept, moved first");
    assert_eq!(exercises[0]["sets"][0]["reps"], 15);
    assert_ne!(exercises[1]["id"], incline_id.as_str(), "squat is new");
    assert_eq!(exercises.as_array().unwrap().len(), 2, "incline is gone");

    let squat_id = exercises[1]["id"].as_str().unwrap();
    for (exercises, field) in [
        (
            json!([{ "id": incline_id, "exerciseId": incline, "sets": set(8) }]),
            "exercises[0].id",
        ),
        (
            json!([{ "id": squat_id, "exerciseId": flyes, "sets": set(8) }]),
            "exercises[0].id",
        ),
        (
            json!([
                { "id": flyes_id, "exerciseId": flyes, "sets": set(8) },
                { "id": flyes_id, "exerciseId": flyes, "sets": set(8) }
            ]),
            "exercises[1].id",
        ),
    ] {
        let (status, problem) = app
            .put(&block_uri, &token, json!({ "exercises": exercises }))
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{exercises}");
        assert_eq!(field_paths(&problem), vec![field]);
    }

    let (status, problem) = app
        .post(
            &format!("/v1/workouts/{workout}/blocks"),
            &token,
            json!({ "exercises": [{ "id": flyes_id, "exerciseId": flyes, "sets": set(8) }] }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(field_paths(&problem), vec!["exercises[0].id"]);

    let missing = format!("/v1/workouts/{workout}/blocks/{incline_id}");
    let (status, _) = app
        .put(
            &missing,
            &token,
            json!({ "exercises": [{ "exerciseId": flyes, "sets": set(8) }] }),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn kept_block_exercises_take_their_new_choices(pool: PgPool) {
    let app = TestApp::new(pool);
    let token = app.sign_up("alex@example.com").await;
    let pull_up = app.exercise_id(&token, "Tractions").await;
    let workout = new_workout(&app, &token, "2026-10-22").await;
    let sets = json!([{ "round": 1, "reps": 8 }]);
    let (status, block) = app
        .post(
            &format!("/v1/workouts/{workout}/blocks"),
            &token,
            json!({ "exercises": [{ "exerciseId": pull_up, "grip": "pronation", "sets": sets }] }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{block}");
    let kept = &block["exercises"][0]["id"];

    let (status, updated) = app
        .put(
            &format!(
                "/v1/workouts/{workout}/blocks/{}",
                block["id"].as_str().unwrap()
            ),
            &token,
            json!({ "exercises": [
                { "id": kept, "exerciseId": pull_up, "grip": "supination", "sets": sets }
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["exercises"][0]["id"], *kept);
    assert_eq!(updated["exercises"][0]["grip"], "supination");
}

/// Logs a one-exercise squat block for the athlete, shares the workout with
/// the coach and returns the workout and the block.
async fn shared_squat_block(app: &TestApp, athlete: &str, coach: &str) -> (String, Value) {
    let squat = app.exercise_id(athlete, "Squat").await;
    let workout = new_workout(app, athlete, "2026-11-10").await;
    let (status, block) = app
        .post(
            &format!("/v1/workouts/{workout}/blocks"),
            athlete,
            json!({ "exercises": [{ "exerciseId": squat, "sets": [
                { "round": 1, "reps": 5, "weightKg": 100.0 },
                { "round": 2, "reps": 5, "weightKg": 100.0 }
            ]}]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let coach_id = app.user_id(coach).await;
    let (status, _) = app
        .put(
            &format!("/v1/workouts/{workout}/shares/{coach_id}"),
            athlete,
            json!(null),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    (workout, block)
}

async fn comment(app: &TestApp, token: &str, block_exercise_id: &Value, text: &str) -> Value {
    let (status, comment) = app
        .post(
            "/v1/comments",
            token,
            json!({ "blockExerciseId": block_exercise_id, "text": text }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{comment}");
    comment
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn athletes_and_their_coaches_discuss_an_exercise(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach, _) = coached_athlete(&app).await;
    let athlete_id = app.user_id(&athlete).await;
    let coach_id = app.user_id(&coach).await;
    let (workout, block) = shared_squat_block(&app, &athlete, &coach).await;
    let target = &block["exercises"][0]["id"];
    let workout_uri = format!("/v1/workouts/{workout}");

    let asked = comment(&app, &athlete, target, "  Gêne à l'épaule \n").await;
    assert_eq!(asked["text"], "Gêne à l'épaule");
    assert_eq!(asked["author"]["id"], athlete_id.as_str());
    assert_eq!(asked["blockExerciseId"], *target);
    let answered = comment(&app, &coach, target, "On redescend à 95 kg").await;
    assert_eq!(answered["author"]["id"], coach_id.as_str());

    for token in [&athlete, &coach] {
        let (_, read) = app.get(&workout_uri, token).await;
        let thread = &read["blocks"][0]["exercises"][0]["comments"];
        assert_eq!(thread[0]["id"], asked["id"]);
        assert_eq!(thread[1]["id"], answered["id"]);
    }
    let squat = block["exercises"][0]["exercise"]["id"].as_str().unwrap();
    let (_, history) = app
        .get(&format!("/v1/exercises/{squat}/performances"), &athlete)
        .await;
    let thread = &history["items"][0]["comments"];
    assert_eq!(thread[1]["text"], "On redescend à 95 kg");
    assert_eq!(thread[1]["author"]["id"], coach_id.as_str());

    for text in [json!(""), json!("   "), json!("x".repeat(2001))] {
        let (status, problem) = app
            .post(
                "/v1/comments",
                &athlete,
                json!({ "blockExerciseId": target, "text": text }),
            )
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(field_paths(&problem), vec!["text"]);
    }

    let answered_uri = format!("/v1/comments/{}", answered["id"].as_str().unwrap());
    let asked_uri = format!("/v1/comments/{}", asked["id"].as_str().unwrap());
    let (status, problem) = app
        .put(&answered_uri, &athlete, json!({ "text": "Non" }))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(problem["type"], "urn:repsheet:problem:not-author");
    let (status, edited) = app
        .put(
            &answered_uri,
            &coach,
            json!({ "text": " On redescend à 92,5 kg " }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(edited["text"], "On redescend à 92,5 kg");
    assert_ne!(edited["updatedAt"], edited["createdAt"]);
    assert_eq!(
        app.get(&answered_uri, &athlete).await.1["text"],
        edited["text"]
    );

    assert_eq!(app.delete(&asked_uri, &coach).await, StatusCode::FORBIDDEN);
    assert_eq!(
        app.delete(&answered_uri, &athlete).await,
        StatusCode::NO_CONTENT,
        "the owner moderates their workout"
    );
    assert_eq!(
        app.delete(&asked_uri, &athlete).await,
        StatusCode::NO_CONTENT
    );
    let (_, read) = app.get(&workout_uri, &athlete).await;
    assert_eq!(read["blocks"][0]["exercises"][0]["comments"], json!([]));
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn only_readers_of_the_workout_comment(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach, _) = coached_athlete(&app).await;
    let other_coach = app.sign_up("thomas@example.com").await;
    app.post(
        "/v1/users/me/coaches",
        &athlete,
        json!({ "email": "thomas@example.com" }),
    )
    .await;
    let stranger = app.sign_up("sam@example.com").await;
    let (workout, block) = shared_squat_block(&app, &athlete, &coach).await;
    let target = &block["exercises"][0]["id"];
    let kept = comment(&app, &coach, target, "Bien").await;
    let kept_uri = format!("/v1/comments/{}", kept["id"].as_str().unwrap());

    for token in [&other_coach, &stranger] {
        let (status, problem) = app
            .post(
                "/v1/comments",
                token,
                json!({ "blockExerciseId": target, "text": "Bonjour" }),
            )
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(field_paths(&problem), vec!["blockExerciseId"]);
        assert_eq!(app.get(&kept_uri, token).await.0, StatusCode::NOT_FOUND);
        let (status, _) = app
            .put(&kept_uri, token, json!({ "text": "Bonjour" }))
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(app.delete(&kept_uri, token).await, StatusCode::NO_CONTENT);
    }
    assert_eq!(app.get(&kept_uri, &athlete).await.0, StatusCode::OK);

    let coach_id = app.user_id(&coach).await;
    assert_eq!(
        app.delete(&format!("/v1/users/me/coaches/{coach_id}"), &athlete)
            .await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(app.get(&kept_uri, &coach).await.0, StatusCode::NOT_FOUND);
    let (status, _) = app
        .put(&kept_uri, &coach, json!({ "text": "Bonjour" }))
        .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "a removed coach loses the thread"
    );
    let (_, read) = app.get(&format!("/v1/workouts/{workout}"), &athlete).await;
    assert_eq!(
        read["blocks"][0]["exercises"][0]["comments"][0]["text"], "Bien",
        "and the athlete keeps it"
    );
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn comments_survive_edits_of_the_block(pool: PgPool) {
    let app = TestApp::new(pool);
    let (athlete, coach, _) = coached_athlete(&app).await;
    let (workout, block) = shared_squat_block(&app, &athlete, &coach).await;
    let exercise = &block["exercises"][0];
    comment(&app, &coach, &exercise["id"], "Garde le dos droit").await;
    let block_uri = format!(
        "/v1/workouts/{workout}/blocks/{}",
        block["id"].as_str().unwrap()
    );

    let (status, edited) = app
        .put(
            &block_uri,
            &athlete,
            json!({ "exercises": [{
                "id": exercise["id"],
                "exerciseId": exercise["exercise"]["id"],
                "sets": [{ "round": 1, "reps": 6, "weightKg": 100.0 }]
            }]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["exercises"][0]["sets"][0]["reps"], 6);
    assert_eq!(
        edited["exercises"][0]["comments"][0]["text"],
        "Garde le dos droit"
    );

    let (_, replaced) = app
        .put(
            &block_uri,
            &athlete,
            json!({ "exercises": [{
                "exerciseId": exercise["exercise"]["id"],
                "sets": [{ "round": 1, "reps": 6, "weightKg": 100.0 }]
            }]}),
        )
        .await;
    assert_eq!(
        replaced["exercises"][0]["comments"],
        json!([]),
        "an exercise sent without its id is a new one"
    );
}

#[sqlx::test(migrator = "repsheet_api::MIGRATOR")]
async fn comments_outlive_their_author(pool: PgPool) {
    let app = TestApp::new(pool);
    let admin = app.super_admin().await;
    let (athlete, coach, _) = coached_athlete(&app).await;
    let coach_id = app.user_id(&coach).await;
    let (workout, block) = shared_squat_block(&app, &athlete, &coach).await;
    comment(&app, &coach, &block["exercises"][0]["id"], "Bien").await;

    assert_eq!(
        app.delete(&format!("/v1/users/{coach_id}"), &admin).await,
        StatusCode::NO_CONTENT
    );

    let (_, read) = app.get(&format!("/v1/workouts/{workout}"), &athlete).await;
    let kept = &read["blocks"][0]["exercises"][0]["comments"][0];
    assert_eq!(kept["text"], "Bien");
    assert!(kept["author"].is_null());
}
