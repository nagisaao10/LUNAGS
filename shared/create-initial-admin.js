const admin = require("firebase-admin");
const { execSync } = require("child_process");

const INITIAL_ADMIN_EMAIL = "nagisa.ito121001m@gmail.com";
const DEFAULT_ADMIN_MODE_MINUTES = 30;

function getFirebaseProjectId() {
    try {
        const result = execSync(
            "firebase use",
            {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            }
        );

        const match = result.match(
            /Active Project:\s*([^\s]+)/i
        );

        if (match) {
            return match[1].trim();
        }

        const line = result
            .split(/\r?\n/)
            .find((value) => value.includes("(current)"));

        if (line) {
            return line
                .replace("(current)", "")
                .trim();
        }

        return null;
    } catch (error) {
        console.error("Firebase CLIからプロジェクトを取得できませんでした。");
        console.error("");
        console.error("先にFirebaseプロジェクトを選択してください。");
        console.error("");
        console.error("例:");
        console.error("  firebase use lunags-development");
        console.error("  firebase use lunags-production");
        console.error("");

        process.exit(1);
    }
}

async function createInitialAdmin() {
    const projectId = getFirebaseProjectId();

    if (!projectId) {
        console.error("Firebaseプロジェクトが選択されていません。");
        process.exit(1);
    }

    const email = INITIAL_ADMIN_EMAIL
        .trim()
        .toLowerCase();

    console.log("");
    console.log("========================================");
    console.log("LUNAGS 初期管理者登録");
    console.log("========================================");
    console.log(`Firebase Project: ${projectId}`);
    console.log(`対象メール: ${email}`);
    console.log("");

    admin.initializeApp({
        projectId,
    });

    const auth = admin.auth();
    const db = admin.firestore();

    let user;

    try {
        user = await auth.getUserByEmail(email);
    } catch (error) {
        if (error.code === "auth/user-not-found") {
            console.error(
                "Firebase Authenticationに対象ユーザーが存在しません。"
            );
            console.error(`対象: ${email}`);
            process.exit(1);
        }

        throw error;
    }

    console.log("Firebase Authentication:");
    console.log(`  UID: ${user.uid}`);
    console.log(`  Email: ${user.email}`);
    console.log(
        `  Name: ${user.displayName || "(未設定)"}`
    );
    console.log("");

    const accountRef = db
        .collection("adminAccounts")
        .doc(email);

    const existing = await accountRef.get();

    if (existing.exists) {
        const data = existing.data();

        if (
            data.uid &&
            data.uid !== user.uid
        ) {
            console.error(
                "既存の管理者アカウントとFirebase AuthenticationのUIDが一致しません。"
            );
            console.error(`Firestore UID: ${data.uid}`);
            console.error(`Auth UID:      ${user.uid}`);
            process.exit(1);
        }

        if (data.active === true) {
            console.log(
                "このアカウントは既に管理者アカウントです。"
            );
            console.log("処理を終了します。");
            return;
        }

        console.log(
            "既存の管理者アカウントを再有効化します。"
        );
    } else {
        console.log(
            "管理者アカウントを新規作成します。"
        );
    }

    const now = admin.firestore.Timestamp.now();

    const existingData = existing.exists
        ? existing.data()
        : {};

    const duration =
        Number.isFinite(
            existingData.adminModeDurationMinutes
        )
            ? existingData.adminModeDurationMinutes
            : DEFAULT_ADMIN_MODE_MINUTES;

    await accountRef.set(
        {
            email,
            uid: user.uid,
            name: user.displayName || "",

            active: true,

            createdBy: user.uid,
            createdByEmail: email,
            createdByName: user.displayName || "",

            createdAt:
                existingData.createdAt || now,

            updatedAt: now,

            adminModeDurationMinutes: duration,

            historyId:
                existingData.historyId || null,
        },
        {
            merge: true,
        }
    );

    console.log("");
    console.log("========================================");
    console.log("初期管理者の登録が完了しました");
    console.log("========================================");
    console.log(`Firebase Project: ${projectId}`);
    console.log(`Email: ${email}`);
    console.log(`UID:   ${user.uid}`);
    console.log("active: true");
    console.log("");
    console.log(
        `Firestore: adminAccounts/${email}`
    );
    console.log("");
}

createInitialAdmin().catch((error) => {
    console.error("");
    console.error(
        "初期管理者の登録に失敗しました。"
    );
    console.error(error);
    process.exit(1);
});