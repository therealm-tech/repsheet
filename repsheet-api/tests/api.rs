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

    let (status, page) = app.get("/v1/exercises?q=DEVELOPPE%20couche", &token).await;
    assert_eq!(status, StatusCode::OK);
    let names: Vec<&str> = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["Développé couché", "Développé couché haltères"]);
    assert_eq!(page["total"], 2);
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
            json!({ "names": { "fr": "Développé Arnold" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "dumbbell" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["custom"], true);
    assert_eq!(created["unilateral"], false);

    let (status, _) = app
        .post(
            "/v1/exercises",
            &alex,
            json!({ "names": { "fr": "developpe arnold" }, "modes": ["reps"], "defaultMode": "reps", "load": "optional", "equipment": "other" }),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = app
        .post(
            "/v1/exercises",
            &alex,
            json!({ "names": { "fr": "SQUAT" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "barbell" }),
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
    let incline = app.exercise_id(&token, "Développé incliné haltères").await;
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
                    { "exerciseId": incline, "sets": [
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

    let (status, fetched) = app.get(&workout_uri, &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(fetched["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(
        fetched["blocks"][0]["exercises"][0]["exercise"]["name"],
        "Développé incliné haltères"
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
            json!({ "names": { "fr": "Curl araignée" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "dumbbell" }),
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
        "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "dumbbell", "builtIn": true
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
        "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "dumbbell", "unilateral": false
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
            json!({ "names": { "fr": "Curl araignée" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "dumbbell" }),
        )
        .await;
    let uri = format!("/v1/exercises/{}", custom["id"].as_str().unwrap());

    let (status, _) = app
        .put(
            &uri,
            &alex,
            json!({ "names": { "fr": "Squat" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "dumbbell", "unilateral": false }),
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
            json!({ "names": { "fr": "Curl araignée" }, "modes": ["time"], "defaultMode": "time", "load": "none", "equipment": "dumbbell", "unilateral": false }),
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
            json!({ "names": { "fr": "Spider curl" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "dumbbell", "unilateral": true }),
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
            json!({ "names": { "fr": "Curl araignée" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "dumbbell" }),
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
            json!({ "names": { "en": "BENCH PRESS" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "barbell" }),
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
            json!({ "names": {}, "modes": ["reps"], "defaultMode": "reps", "load": "optional", "equipment": "other" }),
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
            json!({ "names": { "fr": "Pull-over" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "dumbbell", "builtIn": true }),
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
            json!({ "names": { "fr": "Curl araignée" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "dumbbell" }),
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
                json!({ "names": { "fr": "Curl araignée" }, "modes": ["time"], "defaultMode": "time", "load": "none", "equipment": "dumbbell", "unilateral": false }),
            )
            .await,
            "urn:repsheet:problem:mode-locked",
        ),
        (
            app.put(
                &uri,
                &token,
                json!({ "names": { "fr": "Squat" }, "modes": ["reps"], "defaultMode": "reps", "load": "required", "equipment": "dumbbell", "unilateral": false }),
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
                "equipment": "bodyweight"
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
        body["equipment"] = json!("bodyweight");
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
                "equipment": "bodyweight"
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
            "load": load, "equipment": "bodyweight", "unilateral": false
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
