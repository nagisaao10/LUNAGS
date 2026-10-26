/**
 * LUNAGS Official Portal - Core Script
 * Handles navigation, pagination, dynamic list rendering, and monthly schedule list.
 */

// ==========================================================================
// 1. Header & Navigation Controller
// ==========================================================================
function initHeaderAndNav() {
  const header = document.querySelector('.portal-header');
  const mainHeader = document.getElementById('main-header');
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const mobileNav = document.getElementById('mobileNav');
  const overlay = document.getElementById('mobileNavOverlay');
  const footer = document.getElementById('main-footer') || document.querySelector('.portal-footer');

  // Mixstgirls-style header scroll interaction
  if (mainHeader) {
    function handleMainHeaderScroll() {
      const scrollY = window.scrollY;

      // フッターに近づいたら透過解除
      let nearFooter = false;
      if (footer) {
        const footerRect = footer.getBoundingClientRect();
        nearFooter = footerRect.top < window.innerHeight - 550;
      }

      if (nearFooter) {
        mainHeader.classList.remove('active');
      } else if (scrollY > 50) {
        mainHeader.classList.add('active');
      } else {
        mainHeader.classList.remove('active');
      }
    }

    window.addEventListener('scroll', handleMainHeaderScroll, { passive: true });
    handleMainHeaderScroll();
  }

  // Scroll color shift for legacy portal-header
  function handleScroll() {
    if (!header) return;
    if (window.scrollY > 20) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll(); // Initial check

  // Mobile menu toggle
  function openMobileNav() {
    if (!hamburgerBtn || !mobileNav || !overlay) return;
    hamburgerBtn.setAttribute('aria-expanded', 'true');
    mobileNav.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileNav() {
    if (!hamburgerBtn || !mobileNav || !overlay) return;
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    mobileNav.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', () => {
      const isOpen = hamburgerBtn.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        closeMobileNav();
      } else {
        openMobileNav();
      }
    });
  }

  if (overlay) {
    overlay.addEventListener('click', closeMobileNav);
  }

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && hamburgerBtn && hamburgerBtn.getAttribute('aria-expanded') === 'true') {
      closeMobileNav();
      hamburgerBtn.focus();
    }
  });

  // Current page active navigation indicator
  const currentPath = window.location.pathname.replace(/\/index\.html$/, '/');
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('http') || link.classList.contains('nav-link-external')) return;
    
    // Normalize href
    const linkPath = href.replace(/\/index\.html$/, '/');
    if (currentPath === linkPath || (linkPath !== '/portal/' && currentPath.startsWith(linkPath))) {
      link.classList.add('active');
    }
  });
}

// ==========================================================================
// 2. Data Definitions (Portal Sample Data)
// ==========================================================================
const PORTAL_DATA = {
  news: [
    {
      id: "261026",
      date: "2026/10/26",
      category: "お知らせ",
      title: "LUNAGS 公式ポータルを公開いたしました",
      summary: "企業的かつスタイリッシュなデザインを導入し、最新ニュース・スケジュール・メンバー情報を一元的に確認できる公式ポータルを正式にオープンいたしました。",
      image: "/images/news-sample.svg",
      url: "/portal/news/261026.html"
    },
    {
      id: "261020",
      date: "2026/10/20",
      category: "リリース",
      title: "新世代システム基盤のパフォーマンス改善報告",
      summary: "全体アーキテクチャの最適化を実施し、各種レスポンス時間を従来の約40%短縮いたしました。",
      image: "/images/news-sample.svg",
      url: "/portal/news/261026.html"
    },
    {
      id: "261015",
      date: "2026/10/15",
      category: "イベント",
      title: "秋季カンファレンス2026の開催日程が決定",
      summary: "コミュニティと最新技術をテーマにした秋季カンファレンスのタイムテーブルおよび登壇者を公開いたしました。",
      image: "/images/news-sample.svg",
      url: "/portal/news/261026.html"
    },
    {
      id: "261010",
      date: "2026/10/10",
      category: "アップデート",
      title: "セキュリティガイドライン改定のお知らせ",
      summary: "より安全にご利用いただくため、アカウント管理および外部アクセス時のセキュリティ基準を更新いたしました。",
      image: "/images/news-sample.svg",
      url: "/portal/news/261026.html"
    },
    {
      id: "261005",
      date: "2026/10/05",
      category: "お知らせ",
      title: "オフィシャルグッズ・秋期ラインナップの取り扱い開始",
      summary: "オフィシャルショップにて、秋冬シーズンに向けた公式アイテムの販売を開始いたしました。",
      image: "/images/news-sample.svg",
      url: "/portal/news/261026.html"
    },
    {
      id: "260928",
      date: "2026/09/28",
      category: "メンテナンス",
      title: "システム定期メンテナンス実施のお知らせ",
      summary: "安定運用のための定期メンテナンスを無事完了いたしました。ご協力ありがとうございました。",
      image: "/images/news-sample.svg",
      url: "/portal/news/261026.html"
    },
    {
      id: "260920",
      date: "2026/09/20",
      category: "リリース",
      title: "メンバーダッシュボードv2.4の公開",
      summary: "管理操作を直感的に行える新機能を追加し、操作性の向上を図りました。",
      image: "/images/news-sample.svg",
      url: "/portal/news/261026.html"
    },
    {
      id: "260912",
      date: "2026/09/12",
      category: "イベント",
      title: "オンラインワークショップ「現代的Webデザインと構築」終了御礼",
      summary: "多数のご参加をいただき、盛況のうちに終了いたしました。アーカイブ情報を公開中です。",
      image: "/images/news-sample.svg",
      url: "/portal/news/261026.html"
    },
    {
      id: "260901",
      date: "2026/09/01",
      category: "お知らせ",
      title: "9月度活動方針およびプロジェクト進捗について",
      summary: "今期のロードマップに基づき、新規サービス連携と機能強化を着実に進めてまいります。",
      image: "/images/news-sample.svg",
      url: "/portal/news/261026.html"
    },
    {
      id: "260825",
      date: "2026/08/25",
      category: "アップデート",
      title: "API連携ドキュメントの更新とSDK提供について",
      summary: "外部連携をご検討の方向けに、最新仕様のAPIガイドラインを更新・公開いたしました。",
      image: "/images/news-sample.svg",
      url: "/portal/news/261026.html"
    },
    {
      id: "260815",
      date: "2026/08/15",
      category: "お知らせ",
      title: "夏期特別サポート体制のご案内",
      summary: "夏期期間中のお問い合わせ対応およびサポート運用についてのご案内です。",
      image: "/images/news-sample.svg",
      url: "/portal/news/261026.html"
    },
    {
      id: "260801",
      date: "2026/08/01",
      category: "リリース",
      title: "LUNAGSプラットフォーム プレビュー版の提供開始",
      summary: "先行ユーザーの皆様へ向けたプラットフォーム機能のプレビュー公開を実施いたしました。",
      image: "/images/news-sample.svg",
      url: "/portal/news/261026.html"
    }
  ],

  members: [
    {
      id: "member1",
      name: "翠月 なぎさ",
      role: "Founder / Executive Director",
      bio: "LUNAGSの統括ディレクションおよびプロジェクト全体のデザイン・アーキテクチャ設計を担当。",
      avatar: "/images/member-sample.svg",
      url: "/portal/members/member1.html"
    },
    {
      id: "member2",
      name: "高坂 遥斗",
      role: "Lead Software Architect",
      bio: "高可用性バックエンドとインフラ自動化の設計を担当。安全かつ俊敏なシステム運用を主導。",
      avatar: "/images/member-sample.svg",
      url: "/portal/members/member1.html"
    },
    {
      id: "member3",
      name: "白石 詩織",
      role: "UI/UX & Brand Designer",
      bio: "企業ブランドとしての洗練された美しさと機能美を両立するインターフェース設計を担当。",
      avatar: "/images/member-sample.svg",
      url: "/portal/members/member1.html"
    },
    {
      id: "member4",
      name: "神崎 蓮",
      role: "Security & Cloud Specialist",
      bio: "データ保護、アクセス権限制御、ゼロトラスト環境の構築を通じてシステムの安全性を支える。",
      avatar: "/images/member-sample.svg",
      url: "/portal/members/member1.html"
    },
    {
      id: "member5",
      name: "橘 綾香",
      role: "Operations & Community Lead",
      bio: "メンバーコミュニティの運営、イベント企画、ユーザーサポート全般を統括。",
      avatar: "/images/member-sample.svg",
      url: "/portal/members/member1.html"
    },
    {
      id: "member6",
      name: "西条 健太",
      role: "Front-end Engineer",
      bio: "モダンなWeb標準に準拠したパフォーマンス重視のフロントエンド実装を推進。",
      avatar: "/images/member-sample.svg",
      url: "/portal/members/member1.html"
    },
    {
      id: "member7",
      name: "一条 舞衣",
      role: "Content Director",
      bio: "公式広報、ドキュメンテーション、メディア発信のクオリティ管理を担当。",
      avatar: "/images/member-sample.svg",
      url: "/portal/members/member1.html"
    },
    {
      id: "member8",
      name: "立花 蒼",
      role: "Data Analyst",
      bio: "利用状況のデータ分析とユーザー体験向上のためのインサイト提供を行う。",
      avatar: "/images/member-sample.svg",
      url: "/portal/members/member1.html"
    },
    {
      id: "member9",
      name: "藤堂 拓真",
      role: "DevOps Engineer",
      bio: "CI/CDパイプラインの構築と監視基盤の整備により、高品質なデリバリーを継続支援。",
      avatar: "/images/member-sample.svg",
      url: "/portal/members/member1.html"
    },
    {
      id: "member10",
      name: "森下 美穂",
      role: "Quality Assurance Specialist",
      bio: "機能検証・回帰テストの徹底により、信頼性の高いソフトウェア品質を担保。",
      avatar: "/images/member-sample.svg",
      url: "/portal/members/member1.html"
    },
    {
      id: "member11",
      name: "安藤 悠真",
      role: "System Engineer",
      bio: "サーバー基盤とネットワーク運用の安定化を担当。",
      avatar: "/images/member-sample.svg",
      url: "/portal/members/member1.html"
    },
    {
      id: "member12",
      name: "佐伯 菜々子",
      role: "Technical Support",
      bio: "迅速で丁寧なサポートを通じて利用者の課題解決を支援。",
      avatar: "/images/member-sample.svg",
      url: "/portal/members/member1.html"
    }
  ],

  events: [
    {
      id: "event-annual-2026",
      title: "LUNAGS Annual Summit 2026",
      date: "2026/11/15 (日) 13:00 - 18:00",
      status: "受付中",
      isOpen: true,
      desc: "LUNAGSの年間活動成果と未来の技術展望を発表する年次カンファレンスです。キーノートおよび展示セッションを開催。",
      image: "/images/event-sample.svg",
      url: "/portal/events/event-name.html"
    },
    {
      id: "event-design-system",
      title: "モダンWebデザインシステム構築セミナー",
      date: "2026/11/02 (月) 19:30 - 21:00",
      status: "受付中",
      isOpen: true,
      desc: "一貫性のあるスタイリッシュなUI設計手法とVanilla CSSによる軽量実装ノウハウを解説します。",
      image: "/images/event-sample.svg",
      url: "/portal/events/event-name.html"
    },
    {
      id: "event-cloud-sec",
      title: "ゼロトラスト時代のクラウドセキュリティ実践",
      date: "2026/10/30 (金) 18:30 - 20:00",
      status: "受付中",
      isOpen: true,
      desc: "アカウント管理からデータ保護までの最新ベストプラクティスを共有する技術セミナー。",
      image: "/images/event-sample.svg",
      url: "/portal/events/event-name.html"
    },
    {
      id: "event-autumn-meetup",
      title: "秋季コミュニティ・ミートアップ 2026",
      date: "2026/10/18 (日) 15:00 - 17:30",
      status: "終了",
      isOpen: false,
      desc: "メンバー同士の交流とプロジェクト成果のショートプレゼンテーションを実施いたしました。",
      image: "/images/event-sample.svg",
      url: "/portal/events/event-name.html"
    },
    {
      id: "event-hands-on-api",
      title: "ハンズオン：LUNAGS APIを活用した拡張機能開発",
      date: "2026/09/26 (土) 14:00 - 17:00",
      status: "終了",
      isOpen: false,
      desc: "公式APIを用いた連携アプリケーションの作成実習を行いました。",
      image: "/images/event-sample.svg",
      url: "/portal/events/event-name.html"
    },
    {
      id: "event-frontend-tuning",
      title: "Webパフォーマンス・チューニング勉強会",
      date: "2026/09/10 (木) 19:00 - 20:30",
      status: "終了",
      isOpen: false,
      desc: "Core Web Vitals向上とアクセシビリティ対応の具体策を討議しました。",
      image: "/images/event-sample.svg",
      url: "/portal/events/event-name.html"
    },
    {
      id: "event-summer-camp",
      title: "LUNAGS サマー・アイデアソン 2026",
      date: "2026/08/22 (土) 10:00 - 18:00",
      status: "終了",
      isOpen: false,
      desc: "次世代Webサービスの新機能アイデアを競い合う集中アイデアソン。",
      image: "/images/event-sample.svg",
      url: "/portal/events/event-name.html"
    },
    {
      id: "event-security-audit",
      title: "開発者向けセキュアコーディング講習",
      date: "2026/08/08 (土) 13:00 - 15:30",
      status: "終了",
      isOpen: false,
      desc: "脆弱性を防ぐ堅牢な実装技法を学ぶ実践的ワークショップ。",
      image: "/images/event-sample.svg",
      url: "/portal/events/event-name.html"
    },
    {
      id: "event-release-party",
      title: "LUNAGS プラットフォーム記念セッション",
      date: "2026/07/20 (月) 19:00 - 21:00",
      status: "終了",
      isOpen: false,
      desc: "プラットフォーム開発の軌跡と技術構成について発表いたしました。",
      image: "/images/event-sample.svg",
      url: "/portal/events/event-name.html"
    },
    {
      id: "event-ui-workshop",
      title: "アクセシビリティを考慮したUIコンポーネント設計",
      date: "2026/07/05 (日) 14:00 - 16:30",
      status: "終了",
      isOpen: false,
      desc: "キーボードナビゲーションとコントラスト設計の基礎と応用。",
      image: "/images/event-sample.svg",
      url: "/portal/events/event-name.html"
    },
    {
      id: "event-welcome-session",
      title: "新規参画メンバー歓迎オリエンテーション",
      date: "2026/06/15 (月) 18:30 - 20:00",
      status: "終了",
      isOpen: false,
      desc: "プロジェクト理念とチーム開発フローのオリエンテーション。",
      image: "/images/event-sample.svg",
      url: "/portal/events/event-name.html"
    },
    {
      id: "event-kickoff",
      title: "LUNAGS プロジェクト始動キックオフ",
      date: "2026/05/10 (日) 13:00 - 16:00",
      status: "終了",
      isOpen: false,
      desc: "公式ポータルおよびシステム基盤の構想キックオフミーティング。",
      image: "/images/event-sample.svg",
      url: "/portal/events/event-name.html"
    }
  ],

  // Sample schedule events categorized by YYYY-MM-DD
  schedules: {
    "2026-10-01": [
      {
        id: "s-1001",
        title: "10月度 全体キックオフミーティング",
        time: "10:00 - 11:30",
        size: "normal",
        category: "ミーティング",
        link: "/portal/about"
      }
    ],
    "2026-10-05": [
      {
        id: "s-1005",
        title: "オフィシャルショップ秋期新アイテム販売開始",
        time: "12:00",
        size: "normal",
        category: "ショップ",
        link: "/shop/shop.html"
      }
    ],
    "2026-10-10": [
      {
        id: "s-1010",
        title: "セキュリティガイドライン定期改定",
        time: "終日",
        size: "normal",
        category: "お知らせ",
        link: "/portal/news/261026.html"
      }
    ],
    "2026-10-15": [
      {
        id: "s-1015-1",
        title: "秋季カンファレンス2026 登壇者発表",
        time: "13:00",
        size: "large",
        category: "重要発表",
        link: "/portal/events/event-name.html"
      },
      {
        id: "s-1015-2",
        title: "開発定例レビュー",
        time: "16:00 - 17:30",
        size: "normal",
        category: "ミーティング",
        link: ""
      }
    ],
    "2026-10-18": [
      {
        id: "s-1018",
        title: "秋季コミュニティ・ミートアップ 2026",
        time: "15:00 - 17:30",
        size: "large",
        category: "イベント",
        link: "/portal/events/event-name.html"
      }
    ],
    "2026-10-20": [
      {
        id: "s-1020",
        title: "新世代システム基盤 パフォーマンス改善版ロールアウト",
        time: "03:00 - 05:00",
        size: "normal",
        category: "リリース",
        link: "/portal/news/261026.html"
      }
    ],
    "2026-10-26": [
      {
        id: "s-1026-1",
        title: "LUNAGS 公式ポータル オープン！",
        time: "12:00",
        size: "large",
        category: "重要発表",
        link: "/portal/news/261026.html"
      },
      {
        id: "s-1026-2",
        title: "ポータル開設記念 メンバーメッセージ配信",
        time: "18:00",
        size: "normal",
        category: "お知らせ",
        link: "/portal/members/"
      }
    ],
    "2026-10-30": [
      {
        id: "s-1030",
        title: "ゼロトラスト時代のクラウドセキュリティ実践セミナー",
        time: "18:30 - 20:00",
        size: "large",
        category: "セミナー",
        link: "/portal/events/event-name.html"
      }
    ],
    "2026-11-02": [
      {
        id: "s-1102",
        title: "モダンWebデザインシステム構築セミナー",
        time: "19:30 - 21:00",
        size: "large",
        category: "セミナー",
        link: "/portal/events/event-name.html"
      }
    ],
    "2026-11-15": [
      {
        id: "s-1115",
        title: "LUNAGS Annual Summit 2026 開催",
        time: "13:00 - 18:00",
        size: "large",
        category: "カンファレンス",
        link: "/portal/events/event-name.html"
      }
    ]
  }
};

// ==========================================================================
// 3. Card HTML Generators
// ==========================================================================
function createNewsCard(item) {
  return `
    <article class="news-card">
      <div class="news-card-image">
        <img src="${item.image}" alt="${item.title}" loading="lazy">
      </div>
      <div class="news-card-body">
        <div class="news-card-meta">
          <time datetime="${item.date.replace(/\//g, '-')}">${item.date}</time>
          <span class="badge badge-primary">${item.category}</span>
        </div>
        <h3 class="news-card-title">${item.title}</h3>
        <p class="news-card-summary">${item.summary}</p>
        <a href="${item.url}" class="section-more-link" style="margin-top:auto;">記事を読む →</a>
      </div>
    </article>
  `;
}

function createMemberCard(item) {
  return `
    <article class="member-card">
      <div class="member-avatar">
        <img src="${item.avatar}" alt="${item.name}" loading="lazy">
      </div>
      <h3 class="member-name">${item.name}</h3>
      <div class="member-role">${item.role}</div>
      <p class="member-bio">${item.bio}</p>
      <a href="${item.url}" class="section-more-link" style="margin-top:16px;">プロフィール →</a>
    </article>
  `;
}

function createEventCard(item) {
  return `
    <article class="event-card">
      <div class="event-card-header">
        <img src="${item.image}" alt="${item.title}" loading="lazy">
        <div class="event-card-status">
          <span class="badge ${item.isOpen ? 'badge-status-open' : 'badge-status-closed'}">${item.status}</span>
        </div>
      </div>
      <div class="event-card-body">
        <div class="event-date-row">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          <span>${item.date}</span>
        </div>
        <h3 class="event-card-title">${item.title}</h3>
        <p class="event-card-desc">${item.desc}</p>
        <a href="${item.url}" class="section-more-link" style="margin-top:auto;">詳細を見る →</a>
      </div>
    </article>
  `;
}

// ==========================================================================
// 4. Pagination & List Controller
// ==========================================================================
function renderPagination(totalItems, itemsPerPage, currentPage, onPageChange) {
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const paginationList = document.createElement('ul');
  paginationList.className = 'pagination';

  // Helper to create page link
  function createPageButton(text, pageNum, isDisabled, isActive) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = `pagination-btn ${isActive ? 'active' : ''}`;
    btn.type = 'button';
    btn.textContent = text;
    btn.disabled = isDisabled;
    if (isActive) {
      btn.setAttribute('aria-current', 'page');
    }
    if (!isDisabled && !isActive) {
      btn.addEventListener('click', () => onPageChange(pageNum));
    }
    li.appendChild(btn);
    return li;
  }

  function createEllipsis() {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'pagination-ellipsis';
    span.textContent = '…';
    li.appendChild(span);
    return li;
  }

  // Previous button
  paginationList.appendChild(
    createPageButton('前へ', currentPage - 1, currentPage <= 1, false)
  );

  // Pagination page numbers logic (with ellipsis for large page counts)
  if (totalPages <= 7) {
    for (let p = 1; p <= totalPages; p++) {
      paginationList.appendChild(createPageButton(p, p, false, p === currentPage));
    }
  } else {
    // 1st page
    paginationList.appendChild(createPageButton(1, 1, false, currentPage === 1));

    if (currentPage > 3) {
      paginationList.appendChild(createEllipsis());
    }

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    for (let p = start; p <= end; p++) {
      paginationList.appendChild(createPageButton(p, p, false, p === currentPage));
    }

    if (currentPage < totalPages - 2) {
      paginationList.appendChild(createEllipsis());
    }

    // Last page
    paginationList.appendChild(createPageButton(totalPages, totalPages, false, currentPage === totalPages));
  }

  // Next button
  paginationList.appendChild(
    createPageButton('次へ', currentPage + 1, currentPage >= totalPages, false)
  );

  return paginationList;
}

/**
 * Initializes a paginated list on list pages.
 * Handles ?page=X query param safely.
 */
function initPaginatedList(type) {
  const container = document.getElementById(`${type}Container`);
  const paginationContainer = document.getElementById(`${type}Pagination`);
  if (!container || !paginationContainer) return;

  const allItems = PORTAL_DATA[type] || [];
  const itemsPerPage = 10;
  const totalPages = Math.ceil(allItems.length / itemsPerPage) || 1;

  function getCurrentPageFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const pageParam = parseInt(params.get('page'), 10);
    if (isNaN(pageParam) || pageParam < 1) return 1;
    if (pageParam > totalPages) return totalPages;
    return pageParam;
  }

  function updatePage(page) {
    // Clamp
    let safePage = page;
    if (safePage < 1) safePage = 1;
    if (safePage > totalPages) safePage = totalPages;

    // Update URL query string without reloading
    const url = new URL(window.location.href);
    if (safePage === 1) {
      url.searchParams.delete('page');
    } else {
      url.searchParams.set('page', safePage);
    }
    window.history.pushState({ page: safePage }, '', url.toString());

    render(safePage);

    // Scroll to container top smoothly if scrolled past
    const rect = container.getBoundingClientRect();
    if (rect.top < 0) {
      window.scrollTo({ top: window.scrollY + rect.top - 100, behavior: 'smooth' });
    }
  }

  function render(page) {
    const startIndex = (page - 1) * itemsPerPage;
    const itemsToShow = allItems.slice(startIndex, startIndex + itemsPerPage);

    let html = '';
    itemsToShow.forEach(item => {
      if (type === 'news') html += createNewsCard(item);
      if (type === 'members') html += createMemberCard(item);
      if (type === 'events') html += createEventCard(item);
    });

    container.innerHTML = html;

    // Render pagination controls
    paginationContainer.innerHTML = '';
    const paginationEl = renderPagination(allItems.length, itemsPerPage, page, (newPage) => {
      updatePage(newPage);
    });
    paginationContainer.appendChild(paginationEl);
  }

  // Listen to popstate (browser back/forward button)
  window.addEventListener('popstate', () => {
    render(getCurrentPageFromUrl());
  });

  // Initial render
  render(getCurrentPageFromUrl());
}

/**
 * Renders Top 5 items for TOP page.
 */
function initTopPageSections() {
  const newsTop = document.getElementById('topNewsContainer');
  const membersTop = document.getElementById('topMembersContainer');
  const eventsTop = document.getElementById('topEventsContainer');

  if (newsTop) {
    const newsItems = PORTAL_DATA.news.slice(0, 5);
    newsTop.innerHTML = newsItems.map(createNewsCard).join('');
  }

  if (membersTop) {
    const memberItems = PORTAL_DATA.members.slice(0, 5);
    membersTop.innerHTML = memberItems.map(createMemberCard).join('');
  }

  if (eventsTop) {
    const eventItems = PORTAL_DATA.events.slice(0, 5);
    eventsTop.innerHTML = eventItems.map(createEventCard).join('');
  }
}

// ==========================================================================
// 5. SCHEDULE Controller (Vertical Monthly List Calendar)
// ==========================================================================
function initSchedule() {
  const scheduleWrapper = document.getElementById('scheduleWrapper');
  if (!scheduleWrapper) return;

  // Initial Year & Month (Defaults to October 2026 or current date)
  let currentYear = 2026;
  let currentMonth = 10; // 1-12

  const weekdayNames = ['日', '月', '火', '水', '木', '金', '土'];

  function getDaysInMonth(year, month) {
    // month is 1-12, new Date(year, month, 0) returns last day of month
    return new Date(year, month, 0).getDate();
  }

  function renderSchedule() {
    const formattedMonth = String(currentMonth).padStart(2, '0');
    const ymText = `${currentYear}/${formattedMonth}`;

    // Update top & bottom labels
    document.querySelectorAll('.schedule-ym-label').forEach(el => {
      el.textContent = ymText;
    });

    const daysCount = getDaysInMonth(currentYear, currentMonth);
    const listContainer = document.getElementById('scheduleList');
    if (!listContainer) return;

    let rowsHtml = '';

    for (let day = 1; day <= daysCount; day++) {
      const dateObj = new Date(currentYear, currentMonth - 1, day);
      const dayOfWeek = dateObj.getDay(); // 0: Sun, 6: Sat
      const dayFormatted = String(day).padStart(2, '0');
      const dateKey = `${currentYear}-${formattedMonth}-${dayFormatted}`;

      let dayClass = '';
      let badgeClass = '';
      if (dayOfWeek === 0) {
        badgeClass = 'sun';
      } else if (dayOfWeek === 6) {
        badgeClass = 'sat';
      }

      // Check if today matches real world or mock date
      const isToday = (currentYear === 2026 && currentMonth === 10 && day === 26);
      if (isToday) dayClass += ' today';

      // Check for scheduled events
      const dayEvents = PORTAL_DATA.schedules[dateKey] || [];

      let eventsHtml = '';
      if (dayEvents.length === 0) {
        eventsHtml = `<div class="schedule-no-events">予定はありません</div>`;
      } else {
        dayEvents.forEach(evt => {
          const isLarge = evt.size === 'large';
          const linkHtml = evt.link ? `<a href="${evt.link}" class="schedule-item-link">詳細 →</a>` : '';
          
          eventsHtml += `
            <div class="schedule-item ${isLarge ? 'item-large' : ''}">
              <div class="schedule-item-main">
                <span class="badge ${isLarge ? 'badge-primary' : 'badge-outline'}">${evt.category}</span>
                <span class="schedule-item-title">${evt.title}</span>
                ${evt.time ? `<span class="schedule-item-time">(${evt.time})</span>` : ''}
              </div>
              ${linkHtml}
            </div>
          `;
        });
      }

      rowsHtml += `
        <div class="schedule-row ${dayClass}">
          <div class="schedule-date-col">
            <span class="schedule-day-number">${day}</span>
            <span class="schedule-day-badge ${badgeClass}">${weekdayNames[dayOfWeek]}</span>
          </div>
          <div class="schedule-events-col">
            ${eventsHtml}
          </div>
        </div>
      `;
    }

    listContainer.innerHTML = rowsHtml;
  }

  function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear += 1;
    } else if (currentMonth < 1) {
      currentMonth = 12;
      currentYear -= 1;
    }
    renderSchedule();
  }

  // Bind all prev/next buttons (both top and bottom)
  document.querySelectorAll('.schedule-prev-btn').forEach(btn => {
    btn.addEventListener('click', () => changeMonth(-1));
  });

  document.querySelectorAll('.schedule-next-btn').forEach(btn => {
    btn.addEventListener('click', () => changeMonth(1));
  });

  // Initial render
  renderSchedule();
}

// ==========================================================================
// 6. DOM Ready Dispatcher
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initHeaderAndNav();
  initTopPageSections();
  initPaginatedList('news');
  initPaginatedList('members');
  initPaginatedList('events');
  initSchedule();
});
