// Router, role guards and app bootstrap.
const routes = [
  { path: "/", redirect: () => homeFor(store.user && store.user.role) },
  { path: "/login", component: LoginPage, meta: { guest: true } },
  { path: "/register", component: RegisterPage, meta: { guest: true } },
  { path: "/profile", component: ProfilePage, meta: { roles: ["admin", "examiner", "student"] } },

  { path: "/admin", component: AdminDashboard, meta: { roles: ["admin"] } },
  { path: "/admin/courses", component: AdminCourses, meta: { roles: ["admin"] } },
  { path: "/admin/exams", component: AdminExams, meta: { roles: ["admin"] } },
  { path: "/admin/exams/:id", component: AdminExamDetail, props: true, meta: { roles: ["admin"] } },
  { path: "/admin/slots", component: AdminSlots, meta: { roles: ["admin"] } },
  { path: "/admin/bookings", component: AdminBookings, meta: { roles: ["admin"] } },
  { path: "/admin/examiners", component: AdminExaminers, meta: { roles: ["admin"] } },
  { path: "/admin/students", component: AdminStudents, meta: { roles: ["admin"] } },
  { path: "/admin/reports", component: AdminReports, meta: { roles: ["admin"] } },

  { path: "/examiner", component: ExaminerDashboard, meta: { roles: ["examiner"] } },
  { path: "/examiner/exams", component: ExaminerExams, meta: { roles: ["examiner"] } },
  { path: "/examiner/exams/:id", component: ExaminerExamDetail, props: true, meta: { roles: ["examiner"] } },
  { path: "/examiner/evaluations", component: ExaminerEvaluations, meta: { roles: ["examiner"] } },
  { path: "/examiner/evaluate/:id", component: ExaminerEvaluate, props: true, meta: { roles: ["examiner"] } },

  { path: "/student", component: StudentDashboard, meta: { roles: ["student"] } },
  { path: "/student/exams", component: StudentExams, meta: { roles: ["student"] } },
  { path: "/student/bookings", component: StudentBookings, meta: { roles: ["student"] } },
  { path: "/student/results", component: StudentResults, meta: { roles: ["student"] } },
  { path: "/student/scorecard/:id", component: StudentScorecard, props: true, meta: { roles: ["student"] } },

  { path: "/:pathMatch(.*)*", redirect: "/" },
];

const router = VueRouter.createRouter({
  history: VueRouter.createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  const user = store.user;
  if (to.meta.guest && user) return homeFor(user.role);
  if (to.meta.roles) {
    if (!user) return { path: "/login", query: { next: to.fullPath } };
    if (!to.meta.roles.includes(user.role)) return homeFor(user.role);
  }
});

const App = {
  setup() { return { store }; },
  template: `
    <nav-bar v-if="store.user"></nav-bar>
    <nav v-else class="navbar navbar-dark bg-primary"><div class="container-fluid">
      <span class="navbar-brand fw-semibold"><i class="bi bi-mortarboard-fill me-1"></i> Examination Management Portal</span></div></nav>
    <main><router-view :key="$route.fullPath"></router-view></main>
    <toast-stack></toast-stack>
    <confirm-dialog></confirm-dialog>`,
};

const app = Vue.createApp(App);
app.config.globalProperties.$fmt = fmt;
Object.entries({
  NavBar, ToastStack, ConfirmDialog, ModalBox, StatCard, StatusBadge, EmptyState, Spinner, ChartBox, RescheduleModal,
}).forEach(([name, comp]) => app.component(name, comp));
app.use(router);
app.mount("#app");

// refresh the cached user (role/active status may have changed server-side)
if (store.user) api.get("/api/auth/me").then((u) => setSession(null, u)).catch(() => {});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
