const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const {
    getFirestore,
    Timestamp
} = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DEFAULT_ADMIN_MODE_MINUTES = 30;

function getFirebaseProjectId() {
    try {
        const firebasercPath = path.join(
            __dirname,
            "..",
            ".firebaserc"
        );

        if (!fs.existsSync(firebasercPath)) {
            console.error(
                ".firebaserc が見つかりません。"
            );
            process.exit(1);
        }

        const config = JSON.parse(
            fs.readFileSync(
                firebasercPath,
                "utf8"
            )
        );

        const projectId =
            config?.projects?.default;

        if (!projectId) {
            console.error(
                ".firebaserc にdefaultプロジェクトが設定されていません。"
            );
            process.exit(1);
        }

        return projectId.trim();
    } catch (error) {
        console.error(
            "Firebaseプロジェクトの取得に失敗しました。"
        );
        console.error(error);
        process.exit(1);
    }
}

function createReadline() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

function question(rl, text) {
    return new Promise((resolve) => {
        rl.question(text, (answer) => {
            resolve(answer.trim());
        });
    });
}

async function createInitialAdmin() {
    const projectId = getFirebaseProjectId();

    console.log("");
    console.log("========================================");
    console.log("LUNAGS 初期管理者登録");
    console.log("========================================");
    console.log(
        `Firebase Project: ${projectId}`
    );
    console.log("");

    const rl = createReadline();

    try {
        const emailInput = await question(
            rl,
            "管理者にするメールアドレスを入力してください: "
        );

        const email = emailInput
            .trim()
            .toLowerCase();

        if (!email) {
            console.error("");
            console.error(
                "メールアドレスが入力されていません。"
            );
            process.exit(1);
        }

        if (!email.includes("@")) {
            console.error("");
            console.error(
                "メールアドレスの形式が正しくありません。"
            );
            process.exit(1);
        }

        console.log("");
        console.log(
            `対象メール: ${email}`
        );
        console.log("");

        initializeApp({
            credential: applicationDefault(),
            projectId
        });

        const auth = getAuth();
        const db = getFirestore();

        let user = null;
        let isExistingUser = true;

        /*
         * Firebase Authenticationに
         * 既存ユーザーがいるか確認
         */
        try {
            user = await auth.getUserByEmail(email);
        } catch (error) {
            if (error.code === "auth/user-not-found") {
                isExistingUser = false;
            } else {
                throw error;
            }
        }

        /*
         * 既存ユーザーの場合
         */
        if (isExistingUser) {
            console.log(
                "Firebase Authenticationに既存ユーザーが見つかりました。"
            );
            console.log("");
            console.log(
                `  UID: ${user.uid}`
            );
            console.log(
                `  Email: ${user.email}`
            );
            console.log(
                `  Name: ${user.displayName || "(未設定)"}`
            );
            console.log("");

            const answer = await question(
                rl,
                "このユーザーを管理者アカウントに昇格しますか？ [Y/n]: "
            );

            if (
                answer &&
                !["y", "yes"].includes(
                    answer.toLowerCase()
                )
            ) {
                console.log("");
                console.log(
                    "処理をキャンセルしました。"
                );
                return;
            }
        }

        /*
         * 存在しない場合
         */
        if (!isExistingUser) {
            console.log(
                "Firebase Authenticationに対象ユーザーが存在しません。"
            );
            console.log("");

            const answer = await question(
                rl,
                "このメールアドレスで新規ユーザーを作成しますか？ [Y/n]: "
            );

            if (
                answer &&
                !["y", "yes"].includes(
                    answer.toLowerCase()
                )
            ) {
                console.log("");
                console.log(
                    "処理をキャンセルしました。"
                );
                return;
            }

            console.log("");
            console.log(
                "新規ユーザーのパスワードを入力してください。"
            );
            console.log(
                "※ Firebase Authenticationのパスワードとして使用されます。"
            );
            console.log("");

            const password = await question(
                rl,
                "パスワード: "
            );

            if (!password) {
                console.error("");
                console.error(
                    "パスワードが入力されていません。"
                );
                process.exit(1);
            }

            if (password.length < 6) {
                console.error("");
                console.error(
                    "パスワードは6文字以上にしてください。"
                );
                process.exit(1);
            }

            /*
             * Firebase Authenticationに新規作成
             */
            user = await auth.createUser({
                email,
                password
            });

            console.log("");
            console.log(
                "Firebase Authenticationユーザーを新規作成しました。"
            );
            console.log(
                `  UID: ${user.uid}`
            );
            console.log(
                `  Email: ${user.email}`
            );
            console.log("");
        }

        /*
         * Firestore adminAccounts
         */
        const accountRef = db
            .collection("adminAccounts")
            .doc(email);

        const existing =
            await accountRef.get();

        if (existing.exists) {
            const data =
                existing.data();

            /*
             * 既存の管理者アカウントと
             * Authentication UIDが違う場合は
             * 危険なので停止
             */
            if (
                data.uid &&
                data.uid !== user.uid
            ) {
                console.error("");
                console.error(
                    "既存の管理者アカウントとFirebase AuthenticationのUIDが一致しません。"
                );
                console.error(
                    `Firestore UID: ${data.uid}`
                );
                console.error(
                    `Auth UID:      ${user.uid}`
                );
                console.error("");
                process.exit(1);
            }

            if (data.active === true) {
                console.log("");
                console.log(
                    "このユーザーは既に管理者アカウントです。"
                );
                console.log(
                    "Firebase Authenticationへの変更は行っていません。"
                );
                console.log("");
                return;
            }

            console.log(
                "既存の管理者アカウントを再有効化します。"
            );
        } else {
            console.log(
                "管理者アカウントを作成します。"
            );
        }

        const now = Timestamp.now();

        const existingData = existing.exists
            ? existing.data()
            : {};

        const duration =
            Number.isFinite(
                existingData.adminModeDurationMinutes
            )
                ? existingData.adminModeDurationMinutes
                : DEFAULT_ADMIN_MODE_MINUTES;

        /*
         * adminAccountsに登録
         */
        await accountRef.set(
            {
                email,
                uid: user.uid,
                name: user.displayName || "",
                active: true,

                createdBy: user.uid,
                createdByEmail: email,
                createdByName:
                    user.displayName || "",

                createdAt:
                    existingData.createdAt || now,

                updatedAt: now,

                adminModeDurationMinutes:
                    duration,

                historyId:
                    existingData.historyId || null
            },
            {
                merge: true
            }
        );

        console.log("");
        console.log("========================================");
        console.log("初期管理者の登録が完了しました");
        console.log("========================================");
        console.log(
            `Firebase Project: ${projectId}`
        );
        console.log(
            `Email: ${email}`
        );
        console.log(
            `UID:   ${user.uid}`
        );
        console.log(
            "active: true"
        );
        console.log("");
        console.log(
            `Firestore: adminAccounts/${email}`
        );
        console.log("");

        if (isExistingUser) {
            console.log(
                "既存のFirebase Authenticationユーザーを管理者アカウントへ昇格しました。"
            );
        } else {
            console.log(
                "新規Firebase Authenticationユーザーを作成し、管理者アカウントとして登録しました。"
            );
        }

        console.log("");
    } finally {
        rl.close();
    }
}

createInitialAdmin().catch((error) => {
    console.error("");
    console.error(
        "初期管理者の登録に失敗しました。"
    );
    console.error(error);
    process.exit(1);
});