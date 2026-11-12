// Reusable UI building blocks.

const StatusBadge = {
  props: ["status"],
  template: `<span class="badge" :class="'text-bg-' + $fmt.statusClass(status)">{{ status }}</span>`,
};

const StatCard = {
  props: ["label", "value", "icon", "color"],
  template: `
    <div class="card stat-card h-100 shadow-sm" :style="{borderLeftColor: 'var(--bs-' + (color || 'primary') + ')'}">
      <div class="card-body d-flex justify-content-between align-items-center">
        <div><div class="stat-value">{{ value ?? '–' }}</div><div class="text-body-secondary small">{{ label }}</div></div>
        <i class="bi" :class="['bi-' + icon, 'text-' + (color || 'primary')]"></i>
      </div>
    </div>`,
};

// Vue-driven Bootstrap modal (no Bootstrap JS needed, so state stays reactive)
const ModalBox = {
  props: { show: Boolean, title: String, size: { type: String, default: "" }, z: Number },
  emits: ["close"],
  template: `
    <teleport to="body">
      <div v-if="show" :style="z ? {position: 'relative', zIndex: z} : null">
        <div class="modal-backdrop-custom" @click="$emit('close')"></div>
        <div class="modal d-block" tabindex="-1" @keydown.esc="$emit('close')">
          <div class="modal-dialog modal-dialog-scrollable" :class="size ? 'modal-' + size : ''">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">{{ title }}</h5>
                <button type="button" class="btn-close" @click="$emit('close')"></button>
              </div>
              <div class="modal-body"><slot></slot></div>
              <div class="modal-footer" v-if="$slots.footer"><slot name="footer"></slot></div>
            </div>
          </div>
        </div>
      </div>
    </teleport>`,
};

const EmptyState = {
  props: ["text", "icon"],
  template: `<div class="text-center text-body-secondary py-5">
      <i class="bi fs-1 d-block mb-2" :class="'bi-' + (icon || 'inbox')"></i>{{ text || 'Nothing here yet' }}</div>`,
};

const Spinner = { template: `<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>` };

// Thin ChartJS wrapper
const ChartBox = {
  props: ["type", "labels", "datasets", "options"],
  template: `<div class="chart-box"><canvas ref="c"></canvas></div>`,
  mounted() { this.draw(); },
  watch: { labels() { this.draw(); }, datasets: { deep: true, handler() { this.draw(); } } },
  beforeUnmount() { if (this.chart) this.chart.destroy(); },
  methods: {
    draw() {
      if (this.chart) this.chart.destroy();
      this.chart = new Chart(this.$refs.c, {
        type: this.type,
        data: { labels: this.labels, datasets: this.datasets },
        options: Object.assign({ responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: this.type === "doughnut" || this.type === "pie" } } }, this.options || {}),
      });
    },
  },
};

const ToastStack = {
  setup() { return { store }; },
  template: `
    <div class="toast-stack">
      <div v-for="t in store.toasts" :key="t.id" class="toast show align-items-center border-0 mb-2"
           :class="'text-bg-' + (t.type === 'error' ? 'danger' : t.type)">
        <div class="d-flex"><div class="toast-body">{{ t.message }}</div></div>
      </div>
    </div>`,
};

// Yes/No dialog driven by askConfirm()
const ConfirmDialog = {
  setup() { return { store }; },
  methods: {
    answer(ok) { const c = store.confirm; store.confirm = null; if (c) c.resolve(ok); },
  },
  template: `
    <modal-box :show="!!store.confirm" title="Please confirm" :z="2000" @close="answer(false)">
      <p class="mb-0" style="white-space: pre-line">{{ store.confirm && store.confirm.message }}</p>
      <template #footer>
        <button class="btn btn-secondary" @click="answer(false)">Cancel</button>
        <button class="btn btn-primary" @click="answer(true)">Yes, continue</button>
      </template>
    </modal-box>`,
};

const NavBar = {
  setup() { return { store }; },
  data() { return { notifications: [], timer: null, installPrompt: null }; },
  computed: {
    unread() { return this.notifications.filter((n) => !n.read).length; },
    links() {
      const role = this.store.user && this.store.user.role;
      return {
        admin: [["/admin", "Dashboard", "speedometer2"], ["/admin/courses", "Courses", "journal-bookmark"],
                ["/admin/exams", "Examinations", "clipboard-check"], ["/admin/slots", "Slots", "calendar-week"],
                ["/admin/bookings", "Bookings", "bookmark-check"], ["/admin/examiners", "Examiners", "person-badge"],
                ["/admin/students", "Students", "people"], ["/admin/reports", "Reports", "bar-chart"]],
        examiner: [["/examiner", "Dashboard", "speedometer2"], ["/examiner/exams", "My Examinations", "clipboard-check"],
                   ["/examiner/evaluations", "Evaluations", "pencil-square"]],
        student: [["/student", "Dashboard", "speedometer2"], ["/student/exams", "Examinations", "search"],
                  ["/student/bookings", "My Bookings", "bookmark-check"], ["/student/results", "Results", "award"]],
      }[role] || [];
    },
  },
  mounted() {
    if (this.store.user) this.load();
    this.timer = setInterval(() => this.store.user && this.load(), 30000);
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); this.installPrompt = e; });
  },
  beforeUnmount() { clearInterval(this.timer); },
  watch: { "store.user"(u) { if (u) this.load(); } },
  methods: {
    async load() { try { this.notifications = await api.get("/api/notifications"); } catch (e) { /* ignore */ } },
    async markRead() { if (this.unread) { await api.post("/api/notifications/read"); this.load(); } },
    async openNotification(n) {
      if (n.link && n.link.startsWith("/api/")) {
        try { await api.download(n.link, n.link.split("/").pop()); } catch (e) { toast(e.message, "error"); }
      } else if (n.link) this.$router.push(n.link);
    },
    isActive(p) { const r = this.$route.path; return p.split("/").length === 2 ? r === p : r.startsWith(p); },
    install() { this.installPrompt.prompt(); this.installPrompt = null; },
    logout() { clearSession(); this.$router.push("/login"); },
  },
  template: `
    <nav class="navbar navbar-expand-lg navbar-dark bg-primary sticky-top shadow-sm">
      <div class="container-fluid">
        <router-link class="navbar-brand fw-semibold" to="/"><i class="bi bi-mortarboard-fill me-1"></i> EMP</router-link>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#nav"><span class="navbar-toggler-icon"></span></button>
        <div class="collapse navbar-collapse" id="nav">
          <ul class="navbar-nav me-auto">
            <li class="nav-item" v-for="l in links" :key="l[0]">
              <router-link class="nav-link" :to="l[0]" active-class="" exact-active-class="" :class="{active: isActive(l[0])}">
                <i class="bi me-1" :class="'bi-' + l[2]"></i>{{ l[1] }}</router-link>
            </li>
          </ul>
          <ul class="navbar-nav align-items-lg-center" v-if="store.user">
            <li class="nav-item" v-if="installPrompt">
              <button class="btn btn-sm btn-outline-light me-2" @click="install"><i class="bi bi-download"></i> Install app</button>
            </li>
            <li class="nav-item dropdown">
              <a class="nav-link position-relative" href="#" data-bs-toggle="dropdown" @click.prevent="markRead">
                <i class="bi bi-bell fs-5"></i>
                <span v-if="unread" class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{{ unread }}</span>
              </a>
              <div class="dropdown-menu dropdown-menu-end notif-menu p-0">
                <div class="px-3 py-2 border-bottom fw-semibold">Notifications</div>
                <div v-if="!notifications.length" class="p-3 text-body-secondary small">No notifications</div>
                <a v-for="n in notifications" :key="n.id" href="#" class="dropdown-item small border-bottom text-wrap py-2"
                   :class="{'bg-primary-subtle': !n.read}" @click.prevent="openNotification(n)">
                  <i v-if="n.link && n.link.startsWith('/api/')" class="bi bi-download me-1"></i>{{ n.message }}
                  <div class="text-body-secondary" style="font-size:.75rem">{{ $fmt.datetime(n.created_at) }}</div>
                </a>
              </div>
            </li>
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown">
                <i class="bi bi-person-circle me-1"></i>{{ store.user.name }}
                <span class="badge bg-light text-primary ms-1 text-capitalize">{{ store.user.role }}</span>
              </a>
              <ul class="dropdown-menu dropdown-menu-end">
                <li><router-link class="dropdown-item" to="/profile"><i class="bi bi-person me-2"></i>Profile</router-link></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item text-danger" href="#" @click.prevent="logout"><i class="bi bi-box-arrow-right me-2"></i>Logout</a></li>
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </nav>`,
};

const ProfilePage = {
  setup() { return { store }; },
  data() { return { form: {}, saving: false }; },
  created() { this.form = Object.assign({}, this.store.user, { current_password: "", new_password: "" }); },
  methods: {
    async save() {
      this.saving = true;
      try {
        const u = await api.put("/api/auth/profile", this.form);
        setSession(null, u);
        this.form.current_password = this.form.new_password = "";
        toast("Profile updated");
      } catch (e) { toast(e.message, "error"); }
      this.saving = false;
    },
  },
  template: `
    <div class="container py-4" style="max-width:720px">
      <h3 class="mb-3">My Profile</h3>
      <form class="card shadow-sm" @submit.prevent="save">
        <div class="card-body row g-3">
          <div class="col-md-6"><label class="form-label">Name</label><input class="form-control" v-model.trim="form.name" required minlength="2" maxlength="100"></div>
          <div class="col-md-6"><label class="form-label">Email</label><input class="form-control" :value="form.email" disabled></div>
          <div class="col-md-6"><label class="form-label">Phone</label><input class="form-control" v-model.trim="form.phone" pattern="[0-9+\\- ]{7,15}" title="7-15 digits"></div>
          <template v-if="form.role==='student'">
            <div class="col-md-6"><label class="form-label">Roll No</label><input class="form-control" :value="form.roll_no" disabled></div>
            <div class="col-md-8"><label class="form-label">Program</label><input class="form-control" v-model="form.program" maxlength="100"></div>
            <div class="col-md-4"><label class="form-label">Year</label><input type="number" class="form-control" v-model="form.year" min="1" max="6"></div>
          </template>
          <template v-if="form.role==='examiner'">
            <div class="col-md-6"><label class="form-label">Department</label><input class="form-control" v-model="form.department"></div>
            <div class="col-md-6"><label class="form-label">Designation</label><input class="form-control" v-model="form.designation"></div>
          </template>
          <div class="col-12"><hr><h6>Change password <small class="text-body-secondary">(optional)</small></h6></div>
          <div class="col-md-6"><label class="form-label">Current password</label><input type="password" class="form-control" v-model="form.current_password" :required="!!form.new_password"></div>
          <div class="col-md-6"><label class="form-label">New password</label><input type="password" class="form-control" v-model="form.new_password" minlength="6"></div>
        </div>
        <div class="card-footer text-end"><button class="btn btn-primary" :disabled="saving"><i class="bi bi-save me-1"></i>Save changes</button></div>
      </form>
    </div>`,
};
