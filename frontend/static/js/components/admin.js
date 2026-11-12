// ------------------------------------------------------------------ Admin
const EXAM_TYPES = ["Viva", "Practical", "Project Demo", "Assessment"];
const EXAM_STATUSES = ["Draft", "Slot Creation", "Booking Open", "Closed", "Completed"];

const AdminDashboard = {
  data() { return { s: null, r: null }; },
  async created() {
    try { [this.s, this.r] = await Promise.all([api.get("/api/admin/stats"), api.get("/api/admin/reports")]); }
    catch (e) { toast(e.message, "error"); }
  },
  template: `
    <div class="container-fluid py-4">
      <h3 class="mb-3">Admin Dashboard</h3>
      <spinner v-if="!s"></spinner>
      <template v-else>
        <div class="row g-3 mb-4">
          <div class="col-6 col-md-4 col-xl-2"><stat-card label="Courses" :value="s.courses" icon="journal-bookmark"></stat-card></div>
          <div class="col-6 col-md-4 col-xl-2"><stat-card label="Examinations" :value="s.exams" icon="clipboard-check" color="info"></stat-card></div>
          <div class="col-6 col-md-4 col-xl-2"><stat-card label="Students" :value="s.students" icon="people" color="success"></stat-card></div>
          <div class="col-6 col-md-4 col-xl-2"><stat-card label="Examiners" :value="s.examiners" icon="person-badge" color="warning"></stat-card></div>
          <div class="col-6 col-md-4 col-xl-2"><stat-card label="Exam slots" :value="s.slots" icon="calendar-week" color="secondary"></stat-card></div>
          <div class="col-6 col-md-4 col-xl-2"><stat-card label="Bookings" :value="s.bookings" icon="bookmark-check" color="danger"></stat-card></div>
        </div>
        <div class="row g-3">
          <div class="col-lg-4">
            <div class="card shadow-sm h-100"><div class="card-header bg-body">Examinations by status</div>
              <div class="card-body">
                <ul class="list-group list-group-flush">
                  <li class="list-group-item d-flex justify-content-between" v-for="st in ['Draft','Slot Creation','Booking Open','Closed','Completed']" :key="st">
                    <status-badge :status="st"></status-badge><b>{{ s.exam_status[st] || 0 }}</b></li>
                  <li class="list-group-item d-flex justify-content-between"><span>Active bookings</span><b>{{ s.active_bookings }}</b></li>
                  <li class="list-group-item d-flex justify-content-between"><span>Pending evaluations (exam date passed)</span><b class="text-danger">{{ s.pending_evaluations }}</b></li>
                </ul>
              </div></div>
          </div>
          <div class="col-lg-8" v-if="r">
            <div class="card shadow-sm h-100"><div class="card-header bg-body">Booking trend (last 30 days)</div>
              <div class="card-body"><chart-box type="line" :labels="r.booking_trend.labels.map(d => d.slice(5))"
                :datasets="[{label:'Bookings', data:r.booking_trend.data, cubicInterpolationMode:'monotone', fill:true, borderColor:'#0d6efd', backgroundColor:'rgba(13,110,253,.1)'}]"></chart-box></div></div>
          </div>
        </div>
        <div class="d-flex flex-wrap gap-2 mt-4">
          <router-link class="btn btn-outline-primary" to="/admin/exams"><i class="bi bi-plus-lg"></i> New examination</router-link>
          <router-link class="btn btn-outline-primary" to="/admin/examiners"><i class="bi bi-person-plus"></i> Add examiner</router-link>
          <router-link class="btn btn-outline-primary" to="/admin/reports"><i class="bi bi-bar-chart"></i> Reports & jobs</router-link>
        </div>
      </template>
    </div>`,
};

// ---------------------------------------------------------------- Courses
const AdminCourses = {
  data() { return { items: null, q: "", modal: false, form: {}, saving: false }; },
  created() { this.load(); },
  methods: {
    async load() { this.items = await api.get("/api/admin/courses", { q: this.q }); },
    open(c) { this.form = c ? { ...c } : { code: "", name: "", description: "", credits: 4, status: "Active" }; this.modal = true; },
    async save() {
      this.saving = true;
      try {
        if (this.form.id) await api.put(`/api/admin/courses/${this.form.id}`, this.form);
        else await api.post("/api/admin/courses", this.form);
        toast("Course saved"); this.modal = false; this.load();
      } catch (e) { toast(e.message, "error"); }
      this.saving = false;
    },
    async remove(c) {
      if (!await askConfirm(`Remove course ${c.code}?`)) return;
      try { const r = await api.del(`/api/admin/courses/${c.id}`); toast(r.message); this.load(); }
      catch (e) { toast(e.message, "error"); }
    },
  },
  template: `
    <div class="container-fluid py-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0">Courses</h3>
        <div class="d-flex gap-2">
          <input class="form-control" placeholder="Search code or name" v-model="q" @input="load">
          <button class="btn btn-primary text-nowrap" @click="open()"><i class="bi bi-plus-lg"></i> Add course</button>
        </div>
      </div>
      <spinner v-if="!items"></spinner>
      <empty-state v-else-if="!items.length" text="No courses found"></empty-state>
      <div v-else class="table-responsive card shadow-sm"><table class="table table-hover mb-0">
        <thead class="table-light"><tr><th>Code</th><th>Name</th><th class="d-none d-md-table-cell">Description</th><th>Credits</th><th>Exams</th><th>Status</th><th></th></tr></thead>
        <tbody><tr v-for="c in items" :key="c.id">
          <td class="fw-semibold">{{ c.code }}</td><td>{{ c.name }}</td>
          <td class="d-none d-md-table-cell small text-body-secondary">{{ c.description }}</td>
          <td>{{ c.credits }}</td><td>{{ c.exam_count }}</td><td><status-badge :status="c.status"></status-badge></td>
          <td class="text-end text-nowrap">
            <button class="btn btn-sm btn-outline-secondary me-1" @click="open(c)"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-sm btn-outline-danger" @click="remove(c)"><i class="bi bi-trash"></i></button></td>
        </tr></tbody></table></div>

      <modal-box :show="modal" :title="form.id ? 'Edit course' : 'Add course'" @close="modal=false">
        <form id="courseForm" class="row g-3" @submit.prevent="save">
          <div class="col-4"><label class="form-label">Code *</label><input class="form-control text-uppercase" v-model.trim="form.code" required maxlength="20" pattern="[A-Za-z0-9\\-]+"></div>
          <div class="col-8"><label class="form-label">Name *</label><input class="form-control" v-model.trim="form.name" required maxlength="150"></div>
          <div class="col-12"><label class="form-label">Description</label><textarea class="form-control" rows="3" v-model="form.description"></textarea></div>
          <div class="col-6"><label class="form-label">Credits</label><input type="number" class="form-control" v-model="form.credits" min="0" max="20" required></div>
          <div class="col-6"><label class="form-label">Status</label><select class="form-select" v-model="form.status"><option>Active</option><option>Archived</option></select></div>
        </form>
        <template #footer><button class="btn btn-secondary" @click="modal=false">Cancel</button>
          <button class="btn btn-primary" form="courseForm" :disabled="saving">Save</button></template>
      </modal-box>
    </div>`,
};

// ----------------------------------------------------------- Examinations
const ExamForm = {
  props: ["modelValue", "courses", "examiners"],
  template: `
    <div class="row g-3">
      <div class="col-md-6"><label class="form-label">Course *</label>
        <select class="form-select" v-model="modelValue.course_id" required>
          <option value="" disabled>Select course</option>
          <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.code }} - {{ c.name }}</option></select></div>
      <div class="col-md-6"><label class="form-label">Examination name *</label><input class="form-control" v-model.trim="modelValue.name" required maxlength="150"></div>
      <div class="col-md-4"><label class="form-label">Type *</label>
        <select class="form-select" v-model="modelValue.exam_type" required><option v-for="t in EXAM_TYPES" :key="t">{{ t }}</option></select></div>
      <div class="col-md-4"><label class="form-label">Duration (min) *</label><input type="number" class="form-control" v-model="modelValue.duration" min="5" max="600" required></div>
      <div class="col-md-4"><label class="form-label">Maximum marks *</label><input type="number" class="form-control" v-model="modelValue.max_marks" min="1" max="1000" step="0.5" required></div>
      <div class="col-md-6"><label class="form-label">Slot creation start</label><input type="date" class="form-control" v-model="modelValue.slot_creation_start"></div>
      <div class="col-md-6"><label class="form-label">Slot creation end</label><input type="date" class="form-control" v-model="modelValue.slot_creation_end" :min="modelValue.slot_creation_start"></div>
      <div class="col-md-6"><label class="form-label">Booking start</label><input type="date" class="form-control" v-model="modelValue.booking_start" :min="modelValue.slot_creation_end"></div>
      <div class="col-md-6"><label class="form-label">Booking end (deadline)</label><input type="date" class="form-control" v-model="modelValue.booking_end" :min="modelValue.booking_start"></div>
      <div class="col-12"><label class="form-label">Instructions for students</label><textarea class="form-control" rows="2" v-model="modelValue.instructions"></textarea></div>
      <div class="col-12"><label class="form-label">Assigned examiners</label>
        <div class="border rounded p-2" style="max-height:150px;overflow:auto">
          <div class="form-check" v-for="e in examiners" :key="e.id">
            <input class="form-check-input" type="checkbox" :id="'ex'+e.id" :value="e.id" v-model="modelValue.examiner_ids">
            <label class="form-check-label" :for="'ex'+e.id">{{ e.name }} <small class="text-body-secondary">{{ e.department }}</small></label></div>
          <small v-if="!examiners.length" class="text-body-secondary">No examiners yet</small>
        </div></div>
    </div>`,
  data() { return { EXAM_TYPES }; },
};

const AdminExams = {
  components: { ExamForm },
  data() {
    return { items: null, courses: [], examiners: [], f: { q: "", status: "", type: "", course_id: "" },
             modal: false, form: {}, saving: false, EXAM_TYPES, EXAM_STATUSES };
  },
  async created() {
    this.load();
    [this.courses, this.examiners] = await Promise.all([api.get("/api/admin/courses"), api.get("/api/admin/examiners")]);
  },
  methods: {
    async load() { this.items = await api.get("/api/admin/exams", this.f); },
    open() {
      this.form = { course_id: "", name: "", exam_type: "Viva", duration: 20, max_marks: 100, instructions: "",
                    slot_creation_start: "", slot_creation_end: "", booking_start: "", booking_end: "", examiner_ids: [] };
      this.modal = true;
    },
    async save() {
      this.saving = true;
      try {
        const e = await api.post("/api/admin/exams", this.form);
        toast("Examination created"); this.modal = false; this.$router.push(`/admin/exams/${e.id}`);
      } catch (e) { toast(e.message, "error"); }
      this.saving = false;
    },
  },
  template: `
    <div class="container-fluid py-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0">Examinations</h3>
        <button class="btn btn-primary" @click="open"><i class="bi bi-plus-lg"></i> New examination</button>
      </div>
      <div class="row g-2 mb-3">
        <div class="col-md-4"><input class="form-control" placeholder="Search name / course" v-model="f.q" @input="load"></div>
        <div class="col-md-3"><select class="form-select" v-model="f.course_id" @change="load"><option value="">All courses</option><option v-for="c in courses" :value="c.id">{{ c.code }}</option></select></div>
        <div class="col-6 col-md-2"><select class="form-select" v-model="f.type" @change="load"><option value="">All types</option><option v-for="t in EXAM_TYPES">{{ t }}</option></select></div>
        <div class="col-6 col-md-3"><select class="form-select" v-model="f.status" @change="load"><option value="">All statuses</option><option v-for="s in EXAM_STATUSES">{{ s }}</option></select></div>
      </div>
      <spinner v-if="!items"></spinner>
      <empty-state v-else-if="!items.length" text="No examinations found"></empty-state>
      <div v-else class="table-responsive card shadow-sm"><table class="table table-hover mb-0">
        <thead class="table-light"><tr><th>Examination</th><th>Course</th><th>Type</th><th class="d-none d-lg-table-cell">Booking window</th><th>Slots</th><th>Bookings</th><th>Status</th><th></th></tr></thead>
        <tbody><tr v-for="e in items" :key="e.id" class="cursor-pointer" @click="$router.push('/admin/exams/' + e.id)">
          <td class="fw-semibold">{{ e.name }} <i v-if="e.results_published" class="bi bi-patch-check-fill text-success" title="Results published"></i>
            <div class="small text-body-secondary" v-if="!e.rubric_count"><i class="bi bi-exclamation-triangle text-warning"></i> no rubric</div></td>
          <td>{{ e.course_code }}</td><td>{{ e.exam_type }}</td>
          <td class="d-none d-lg-table-cell small">{{ $fmt.date(e.booking_start) }} → {{ $fmt.date(e.booking_end) }}</td>
          <td>{{ e.slot_count }}</td><td>{{ e.booking_count }}</td>
          <td><status-badge :status="e.status"></status-badge></td>
          <td><i class="bi bi-chevron-right"></i></td>
        </tr></tbody></table></div>

      <modal-box :show="modal" title="New examination" size="lg" @close="modal=false">
        <form id="examForm" @submit.prevent="save"><exam-form v-model="form" :courses="courses" :examiners="examiners"></exam-form></form>
        <template #footer><button class="btn btn-secondary" @click="modal=false">Cancel</button>
          <button class="btn btn-primary" form="examForm" :disabled="saving">Create</button></template>
      </modal-box>
    </div>`,
};

const AdminExamDetail = {
  components: { ExamForm },
  props: ["id"],
  data() {
    return { exam: null, tab: "overview", slots: [], bookings: [], courses: [], examiners: [],
             editModal: false, form: {}, crit: null, saving: false, resched: null };
  },
  computed: {
    weightTotal() { return (this.exam?.rubric || []).reduce((a, c) => a + (+c.weightage || 0), 0); },
    pending() { return this.bookings.filter((b) => b.status === "Booked").length; },
    actions() {
      const s = this.exam.status;
      const a = [];
      if (["Draft", "Booking Open"].includes(s)) a.push(["open_slot_creation", "Open slot creation", "info", "unlock"]);
      if (s === "Slot Creation") a.push(["close_slot_creation", "Close slot creation", "secondary", "lock"]);
      if (["Draft", "Slot Creation", "Closed"].includes(s)) a.push(["open_booking", "Open student booking", "success", "door-open"]);
      if (s === "Booking Open") a.push(["close_booking", "Close booking", "warning", "door-closed"]);
      if (["Closed", "Booking Open"].includes(s)) a.push(["complete", "Mark completed", "dark", "check2-all"]);
      if (s === "Completed") a.push(["reopen", "Re-open (Closed)", "outline-secondary", "arrow-counterclockwise"]);
      return a;
    },
  },
  async created() {
    await this.load();
    [this.courses, this.examiners] = await Promise.all([api.get("/api/admin/courses"), api.get("/api/admin/examiners")]);
  },
  methods: {
    async load() {
      try {
        [this.exam, this.slots, this.bookings] = await Promise.all([
          api.get(`/api/exams/${this.id}`), api.get("/api/admin/slots", { exam_id: this.id }),
          api.get("/api/admin/bookings", { exam_id: this.id })]);
      } catch (e) { toast(e.message, "error"); this.$router.push("/admin/exams"); }
    },
    async act(action) {
      try { this.exam = await api.post(`/api/admin/exams/${this.id}/status`, { action }); toast(`Status: ${this.exam.status}`); }
      catch (e) { toast(e.message, "error"); }
    },
    async publish(flag, force = false) {
      try {
        this.exam = await api.post(`/api/admin/exams/${this.id}/publish`, { publish: flag, force });
        toast(flag ? "Results published - students notified" : "Results unpublished");
      } catch (e) {
        if (e.status === 409 && await askConfirm(e.message + "\n\nPublish anyway?")) return this.publish(flag, true);
        toast(e.message, "error");
      }
    },
    openEdit() {
      this.form = { ...this.exam, examiner_ids: [...this.exam.examiner_ids] };
      for (const k of ["slot_creation_start", "slot_creation_end", "booking_start", "booking_end"]) this.form[k] = this.form[k] || "";
      this.editModal = true;
    },
    async saveExam() {
      this.saving = true;
      try { this.exam = await api.put(`/api/admin/exams/${this.id}`, this.form); this.editModal = false; toast("Examination updated"); }
      catch (e) { toast(e.message, "error"); }
      this.saving = false;
    },
    async removeExam() {
      if (!await askConfirm("Delete this examination? This cannot be undone.")) return;
      try { await api.del(`/api/admin/exams/${this.id}`); toast("Deleted"); this.$router.push("/admin/exams"); }
      catch (e) { toast(e.message, "error"); }
    },
    editCrit(c) { this.crit = c ? { ...c } : { name: "", max_marks: 10, weightage: Math.max(0, 100 - this.weightTotal), description: "" }; },
    async saveCrit() {
      try {
        if (this.crit.id) await api.put(`/api/admin/rubric/${this.crit.id}`, this.crit);
        else await api.post(`/api/admin/exams/${this.id}/rubric`, this.crit);
        this.crit = null; toast("Rubric saved"); this.exam = await api.get(`/api/exams/${this.id}`);
      } catch (e) { toast(e.message, "error"); }
    },
    async delCrit(c) {
      if (!await askConfirm(`Remove criterion "${c.name}"?`)) return;
      try { await api.del(`/api/admin/rubric/${c.id}`); this.exam = await api.get(`/api/exams/${this.id}`); }
      catch (e) { toast(e.message, "error"); }
    },
    openResched(b) { this.resched = { booking: b, slot_id: "", reason: "" }; },
    async doResched() {
      try {
        await api.post(`/api/admin/bookings/${this.resched.booking.id}/reschedule`, { slot_id: this.resched.slot_id, reason: this.resched.reason });
        toast("Booking rescheduled"); this.resched = null; this.load();
      } catch (e) { toast(e.message, "error"); }
    },
  },
  template: `
    <div class="container-fluid py-4">
      <spinner v-if="!exam"></spinner>
      <template v-else>
        <router-link to="/admin/exams" class="small"><i class="bi bi-arrow-left"></i> All examinations</router-link>
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mt-2 mb-3">
          <div><h3 class="mb-1">{{ exam.name }} <status-badge :status="exam.status"></status-badge></h3>
            <div class="text-body-secondary">{{ exam.course_code }} · {{ exam.course_name }} · {{ exam.exam_type }} · {{ exam.duration }} min · {{ exam.max_marks }} marks</div></div>
          <div class="d-flex flex-wrap gap-2">
            <button class="btn btn-outline-secondary btn-sm" @click="openEdit"><i class="bi bi-pencil"></i> Edit</button>
            <button class="btn btn-outline-danger btn-sm" @click="removeExam"><i class="bi bi-trash"></i></button>
          </div>
        </div>

        <ul class="nav nav-tabs mb-3">
          <li class="nav-item" v-for="t in [['overview','Overview'],['rubric','Rubric ('+exam.rubric.length+')'],['slots','Slots ('+slots.length+')'],['bookings','Bookings ('+bookings.length+')']]" :key="t[0]">
            <a class="nav-link" :class="{active: tab===t[0]}" href="#" @click.prevent="tab=t[0]">{{ t[1] }}</a></li>
        </ul>

        <div v-if="tab==='overview'" class="row g-3">
          <div class="col-lg-7">
            <div class="card shadow-sm"><div class="card-body">
              <h6 class="text-body-secondary">Timeline</h6>
              <table class="table table-sm mb-3">
                <tr><td>Slot creation</td><td>{{ $fmt.date(exam.slot_creation_start) }} → {{ $fmt.date(exam.slot_creation_end) }}</td></tr>
                <tr><td>Student booking</td><td>{{ $fmt.date(exam.booking_start) }} → {{ $fmt.date(exam.booking_end) }}</td></tr>
              </table>
              <h6 class="text-body-secondary">Assigned examiners</h6>
              <p><span class="badge text-bg-light border me-1" v-for="e in exam.examiners" :key="e.id">{{ e.name }}</span>
                 <span v-if="!exam.examiners.length" class="text-danger small">None assigned</span></p>
              <h6 class="text-body-secondary">Instructions</h6><p class="small" style="white-space:pre-line">{{ exam.instructions || '—' }}</p>
            </div></div>
          </div>
          <div class="col-lg-5">
            <div class="card shadow-sm mb-3"><div class="card-body">
              <h6 class="text-body-secondary">Workflow controls</h6>
              <p class="small text-body-secondary">Draft → Slot Creation → Booking Open → Closed → Completed</p>
              <div class="d-grid gap-2">
                <button v-for="a in actions" :key="a[0]" class="btn" :class="'btn-' + a[2]" @click="act(a[0])"><i class="bi me-1" :class="'bi-'+a[3]"></i>{{ a[1] }}</button>
              </div>
            </div></div>
            <div class="card shadow-sm"><div class="card-body">
              <h6 class="text-body-secondary">Results</h6>
              <p class="small mb-2">{{ bookings.filter(b => b.evaluated).length }} evaluated · <span :class="{'text-danger': pending}">{{ pending }} pending</span></p>
              <button v-if="!exam.results_published" class="btn btn-success w-100" @click="publish(true)"><i class="bi bi-megaphone"></i> Publish results</button>
              <button v-else class="btn btn-outline-warning w-100" @click="publish(false)"><i class="bi bi-eye-slash"></i> Unpublish results</button>
            </div></div>
          </div>
        </div>

        <div v-if="tab==='rubric'">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span>Total weightage: <b :class="weightTotal === 100 ? 'text-success' : 'text-warning'">{{ weightTotal }}%</b></span>
            <button class="btn btn-primary btn-sm" @click="editCrit()"><i class="bi bi-plus-lg"></i> Add criterion</button>
          </div>
          <empty-state v-if="!exam.rubric.length" text="No rubric criteria yet" icon="list-check"></empty-state>
          <div v-else class="table-responsive card shadow-sm"><table class="table mb-0">
            <thead class="table-light"><tr><th>Criterion</th><th>Max marks</th><th>Weightage</th><th>Description</th><th></th></tr></thead>
            <tbody><tr v-for="c in exam.rubric" :key="c.id"><td class="fw-semibold">{{ c.name }}</td><td>{{ c.max_marks }}</td><td>{{ c.weightage }}%</td>
              <td class="small">{{ c.description }}</td>
              <td class="text-end text-nowrap"><button class="btn btn-sm btn-outline-secondary me-1" @click="editCrit(c)"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm btn-outline-danger" @click="delCrit(c)"><i class="bi bi-trash"></i></button></td></tr></tbody></table></div>
          <p class="small text-body-secondary mt-2">Total marks = Σ(marks ÷ criterion max × weightage) ÷ Σweightage × {{ exam.max_marks }}</p>
        </div>

        <div v-if="tab==='slots'">
          <empty-state v-if="!slots.length" text="Examiners have not created any slots yet" icon="calendar-x"></empty-state>
          <div v-else class="table-responsive card shadow-sm"><table class="table mb-0">
            <thead class="table-light"><tr><th>Date</th><th>Time</th><th>Examiner</th><th>Seats</th><th>Status</th></tr></thead>
            <tbody><tr v-for="s in slots" :key="s.id"><td>{{ $fmt.date(s.date) }}</td><td>{{ s.start_time }}–{{ s.end_time }}</td><td>{{ s.examiner_name }}</td>
              <td>{{ s.capacity - s.available_seats }}/{{ s.capacity }}</td><td><status-badge :status="s.status"></status-badge></td></tr></tbody></table></div>
          <router-link class="btn btn-link px-0" :to="{path:'/admin/slots', query:{exam_id:id}}">Manage slots (reschedule / change examiner) →</router-link>
        </div>

        <div v-if="tab==='bookings'">
          <empty-state v-if="!bookings.length" text="No bookings yet"></empty-state>
          <div v-else class="table-responsive card shadow-sm"><table class="table mb-0">
            <thead class="table-light"><tr><th>Student</th><th>Slot</th><th>Examiner</th><th>Status</th><th>Marks</th><th></th></tr></thead>
            <tbody><tr v-for="b in bookings" :key="b.id">
              <td>{{ b.student_name }}<div class="small text-body-secondary">{{ b.roll_no }}</div></td>
              <td>{{ $fmt.date(b.date) }} {{ b.start_time }}</td><td>{{ b.examiner_name }}</td>
              <td><status-badge :status="b.status"></status-badge></td>
              <td>{{ b.evaluation && b.evaluation.status==='Submitted' ? b.evaluation.total_marks : '–' }}</td>
              <td class="text-end"><button v-if="b.status==='Booked'" class="btn btn-sm btn-outline-primary" @click="openResched(b)"><i class="bi bi-arrow-left-right"></i> Reschedule</button></td>
            </tr></tbody></table></div>
        </div>
      </template>

      <modal-box :show="editModal" title="Edit examination" size="lg" @close="editModal=false">
        <form id="examEdit" @submit.prevent="saveExam"><exam-form v-model="form" :courses="courses" :examiners="examiners"></exam-form></form>
        <template #footer><button class="btn btn-secondary" @click="editModal=false">Cancel</button><button class="btn btn-primary" form="examEdit" :disabled="saving">Save</button></template>
      </modal-box>

      <modal-box :show="!!crit" :title="crit && crit.id ? 'Edit criterion' : 'Add criterion'" @close="crit=null">
        <form v-if="crit" id="critForm" class="row g-3" @submit.prevent="saveCrit">
          <div class="col-12"><label class="form-label">Criterion name *</label><input class="form-control" v-model.trim="crit.name" required maxlength="120"></div>
          <div class="col-6"><label class="form-label">Maximum marks *</label><input type="number" step="0.5" min="0.5" max="1000" class="form-control" v-model="crit.max_marks" required></div>
          <div class="col-6"><label class="form-label">Weightage (%) *</label><input type="number" step="0.5" min="0" max="100" class="form-control" v-model="crit.weightage" required></div>
          <div class="col-12"><label class="form-label">Description</label><textarea class="form-control" v-model="crit.description" rows="2"></textarea></div>
        </form>
        <template #footer><button class="btn btn-secondary" @click="crit=null">Cancel</button><button class="btn btn-primary" form="critForm">Save</button></template>
      </modal-box>

      <reschedule-modal :data="resched" :slots="slots" @close="resched=null" @save="doResched"></reschedule-modal>
    </div>`,
};

// Shared modal for moving a booking to another slot (possibly another examiner)
const RescheduleModal = {
  props: ["data", "slots"],
  emits: ["close", "save"],
  template: `
    <modal-box :show="!!data" title="Reschedule / reassign booking" @close="$emit('close')">
      <form v-if="data" id="reschedForm" @submit.prevent="$emit('save')">
        <p class="small mb-2"><b>{{ data.booking.student_name }}</b> — currently {{ $fmt.date(data.booking.date) }} {{ data.booking.start_time }} with {{ data.booking.examiner_name }}</p>
        <label class="form-label">Move to slot *</label>
        <select class="form-select mb-3" v-model="data.slot_id" required>
          <option value="" disabled>Select a slot</option>
          <option v-for="s in slots.filter(s => s.id !== data.booking.slot_id && s.available_seats > 0 && !['Cancelled','Completed'].includes(s.status))" :key="s.id" :value="s.id">
            {{ s.date }} {{ s.start_time }}-{{ s.end_time }} · {{ s.examiner_name }} · {{ s.available_seats }} seat(s) left</option>
        </select>
        <label class="form-label">Reason *</label>
        <input class="form-control" v-model.trim="data.reason" required maxlength="300" placeholder="e.g. Examiner unavailable / student medical leave">
        <p class="small text-body-secondary mt-2 mb-0">Choosing a slot of another examiner reassigns the student to that examiner. The student is notified.</p>
      </form>
      <template #footer><button class="btn btn-secondary" @click="$emit('close')">Cancel</button><button class="btn btn-primary" form="reschedForm">Move booking</button></template>
    </modal-box>`,
};

// ------------------------------------------------------------------ Slots
const AdminSlots = {
  data() { return { items: null, exams: [], examiners: [], f: { exam_id: this.$route.query.exam_id || "", examiner_id: "", status: "", date: "", q: "" }, edit: null }; },
  async created() {
    this.load();
    [this.exams, this.examiners] = await Promise.all([api.get("/api/admin/exams"), api.get("/api/admin/examiners")]);
  },
  methods: {
    async load() { this.items = await api.get("/api/admin/slots", this.f); },
    open(s) { this.edit = { ...s }; },
    async save() {
      try { await api.put(`/api/admin/slots/${this.edit.id}`, this.edit); toast("Slot updated, booked students notified"); this.edit = null; this.load(); }
      catch (e) { toast(e.message, "error"); }
    },
  },
  template: `
    <div class="container-fluid py-4">
      <h3>All examiner slots</h3>
      <div class="row g-2 mb-3">
        <div class="col-md-3"><input class="form-control" placeholder="Search exam / examiner" v-model="f.q" @input="load"></div>
        <div class="col-md-3"><select class="form-select" v-model="f.exam_id" @change="load"><option value="">All examinations</option><option v-for="e in exams" :value="e.id">{{ e.name }}</option></select></div>
        <div class="col-md-2"><select class="form-select" v-model="f.examiner_id" @change="load"><option value="">All examiners</option><option v-for="e in examiners" :value="e.id">{{ e.name }}</option></select></div>
        <div class="col-6 col-md-2"><select class="form-select" v-model="f.status" @change="load"><option value="">Any status</option><option>Available</option><option>Full</option><option>Cancelled</option><option>Completed</option></select></div>
        <div class="col-6 col-md-2"><input type="date" class="form-control" v-model="f.date" @change="load"></div>
      </div>
      <spinner v-if="!items"></spinner>
      <empty-state v-else-if="!items.length" text="No slots match"></empty-state>
      <div v-else class="table-responsive card shadow-sm"><table class="table table-hover mb-0">
        <thead class="table-light"><tr><th>Examination</th><th>Examiner</th><th>Date</th><th>Time</th><th>Booked</th><th>Status</th><th></th></tr></thead>
        <tbody><tr v-for="s in items" :key="s.id">
          <td>{{ s.exam_name }}</td><td>{{ s.examiner_name }}</td><td>{{ $fmt.date(s.date) }}</td><td>{{ s.start_time }}–{{ s.end_time }}</td>
          <td>{{ s.booked_count }}/{{ s.capacity }}</td><td><status-badge :status="s.status"></status-badge></td>
          <td class="text-end"><button class="btn btn-sm btn-outline-primary text-nowrap" @click="open(s)"><i class="bi bi-calendar2-event"></i> Reschedule</button></td>
        </tr></tbody></table></div>

      <modal-box :show="!!edit" title="Reschedule slot / change examiner" @close="edit=null">
        <form v-if="edit" id="slotEdit" class="row g-3" @submit.prevent="save">
          <div class="col-12 small text-body-secondary">{{ edit.exam_name }} · {{ edit.booked_count }} student(s) booked — all will be notified.</div>
          <div class="col-md-4"><label class="form-label">Date</label><input type="date" class="form-control" v-model="edit.date" required></div>
          <div class="col-6 col-md-4"><label class="form-label">Start</label><input type="time" class="form-control" v-model="edit.start_time" required></div>
          <div class="col-6 col-md-4"><label class="form-label">End</label><input type="time" class="form-control" v-model="edit.end_time" required></div>
          <div class="col-md-6"><label class="form-label">Examiner</label><select class="form-select" v-model="edit.examiner_id"><option v-for="e in examiners.filter(e => e.active)" :value="e.id">{{ e.name }}</option></select></div>
          <div class="col-md-6"><label class="form-label">Status</label><select class="form-select" v-model="edit.status"><option>Available</option><option>Full</option><option>Cancelled</option><option>Completed</option></select></div>
          <div class="col-12"><label class="form-label">Meeting link</label><input type="url" class="form-control" v-model="edit.meeting_link"></div>
        </form>
        <template #footer><button class="btn btn-secondary" @click="edit=null">Cancel</button><button class="btn btn-primary" form="slotEdit">Save</button></template>
      </modal-box>
    </div>`,
};

// --------------------------------------------------------------- Bookings
const AdminBookings = {
  data() { return { items: null, exams: [], f: { q: "", exam_id: "", status: "" }, resched: null, slots: [], history: null }; },
  async created() { this.load(); this.exams = await api.get("/api/admin/exams"); },
  methods: {
    async load() { this.items = await api.get("/api/admin/bookings", this.f); },
    async openResched(b) { this.slots = await api.get("/api/admin/slots", { exam_id: b.exam_id }); this.resched = { booking: b, slot_id: "", reason: "" }; },
    async doResched() {
      try {
        await api.post(`/api/admin/bookings/${this.resched.booking.id}/reschedule`, { slot_id: this.resched.slot_id, reason: this.resched.reason });
        toast("Booking moved"); this.resched = null; this.load();
      } catch (e) { toast(e.message, "error"); }
    },
    async cancel(b) {
      if (!await askConfirm(`Cancel ${b.student_name}'s booking?`)) return;
      try { await api.post(`/api/admin/bookings/${b.id}/cancel`); toast("Booking cancelled"); this.load(); } catch (e) { toast(e.message, "error"); }
    },
    async showHistory(b) { this.history = { booking: b, items: await api.get(`/api/admin/bookings/${b.id}/history`) }; },
  },
  template: `
    <div class="container-fluid py-4">
      <h3>Bookings</h3>
      <div class="row g-2 mb-3">
        <div class="col-md-5"><input class="form-control" placeholder="Search student name, email, roll no or exam" v-model="f.q" @input="load"></div>
        <div class="col-md-4"><select class="form-select" v-model="f.exam_id" @change="load"><option value="">All examinations</option><option v-for="e in exams" :value="e.id">{{ e.name }}</option></select></div>
        <div class="col-md-3"><select class="form-select" v-model="f.status" @change="load"><option value="">Any status</option><option>Booked</option><option>Completed</option><option>Cancelled</option><option>Absent</option></select></div>
      </div>
      <spinner v-if="!items"></spinner>
      <empty-state v-else-if="!items.length" text="No bookings match"></empty-state>
      <div v-else class="table-responsive card shadow-sm"><table class="table table-hover mb-0">
        <thead class="table-light"><tr><th>#</th><th>Student</th><th>Examination</th><th>Slot</th><th>Examiner</th><th>Status</th><th>Marks</th><th></th></tr></thead>
        <tbody><tr v-for="b in items" :key="b.id">
          <td>{{ b.id }}</td>
          <td>{{ b.student_name }}<div class="small text-body-secondary">{{ b.roll_no }}</div></td>
          <td>{{ b.exam_name }}<div class="small text-body-secondary">{{ b.course_code }}</div></td>
          <td class="text-nowrap">{{ $fmt.date(b.date) }}<div class="small">{{ b.start_time }}–{{ b.end_time }}</div></td>
          <td>{{ b.examiner_name }}</td><td><status-badge :status="b.status"></status-badge></td>
          <td>{{ b.evaluation && b.evaluation.status==='Submitted' ? b.evaluation.total_marks : '–' }}</td>
          <td class="text-end text-nowrap">
            <button class="btn btn-sm btn-outline-secondary me-1" title="Reschedule history" @click="showHistory(b)"><i class="bi bi-clock-history"></i></button>
            <template v-if="b.status==='Booked'">
              <button class="btn btn-sm btn-outline-primary me-1" title="Reschedule / reassign" @click="openResched(b)"><i class="bi bi-arrow-left-right"></i></button>
              <button class="btn btn-sm btn-outline-danger" title="Cancel" @click="cancel(b)"><i class="bi bi-x-lg"></i></button></template>
          </td>
        </tr></tbody></table></div>
      <reschedule-modal :data="resched" :slots="slots" @close="resched=null" @save="doResched"></reschedule-modal>
      <modal-box :show="!!history" title="Reschedule history" @close="history=null">
        <template v-if="history">
          <empty-state v-if="!history.items.length" text="This booking was never rescheduled" icon="clock"></empty-state>
          <ul class="list-group" v-else><li class="list-group-item" v-for="h in history.items">
            <div class="small text-body-secondary">{{ $fmt.datetime(h.changed_at) }}</div>{{ h.from }} → <b>{{ h.to }}</b><div class="small">Reason: {{ h.reason || '—' }}</div></li></ul>
        </template>
      </modal-box>
    </div>`,
};

// -------------------------------------------------------------- Examiners
const AdminExaminers = {
  data() { return { items: null, q: "", form: null }; },
  created() { this.load(); },
  methods: {
    async load() { this.items = await api.get("/api/admin/examiners", { q: this.q }); },
    open(e) { this.form = e ? { ...e, password: "" } : { name: "", email: "", password: "", phone: "", department: "", designation: "" }; },
    async save() {
      try {
        if (this.form.id) await api.put(`/api/admin/examiners/${this.form.id}`, this.form);
        else await api.post("/api/admin/examiners", this.form);
        toast("Examiner saved"); this.form = null; this.load();
      } catch (e) { toast(e.message, "error"); }
    },
    async toggle(e) {
      try { await api.put(`/api/admin/examiners/${e.id}`, { active: !e.active }); this.load(); } catch (err) { toast(err.message, "error"); }
    },
    async remove(e) {
      if (!await askConfirm(`Remove ${e.name}?`)) return;
      try { const r = await api.del(`/api/admin/examiners/${e.id}`); toast(r.message); this.load(); } catch (err) { toast(err.message, "error"); }
    },
  },
  template: `
    <div class="container-fluid py-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0">Examiners</h3>
        <div class="d-flex gap-2"><input class="form-control" placeholder="Search name, email, department" v-model="q" @input="load">
          <button class="btn btn-primary text-nowrap" @click="open()"><i class="bi bi-person-plus"></i> Add examiner</button></div>
      </div>
      <spinner v-if="!items"></spinner>
      <empty-state v-else-if="!items.length" text="No examiners"></empty-state>
      <div v-else class="table-responsive card shadow-sm"><table class="table table-hover mb-0">
        <thead class="table-light"><tr><th>Name</th><th>Contact</th><th>Department</th><th>Assigned exams</th><th>Slots</th><th>Status</th><th></th></tr></thead>
        <tbody><tr v-for="e in items" :key="e.id" :class="{'opacity-50': !e.active}">
          <td class="fw-semibold">{{ e.name }}<div class="small text-body-secondary">{{ e.designation }}</div></td>
          <td class="small">{{ e.email }}<br>{{ e.phone }}</td><td>{{ e.department }}</td>
          <td class="small"><span class="badge text-bg-light border me-1" v-for="x in e.assigned_exams">{{ x.name }}</span></td>
          <td>{{ e.slot_count }}</td>
          <td><status-badge :status="e.active ? e.examiner_status : 'Inactive'"></status-badge></td>
          <td class="text-end text-nowrap">
            <button class="btn btn-sm btn-outline-secondary me-1" @click="open(e)"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-sm me-1" :class="e.active ? 'btn-outline-warning' : 'btn-outline-success'" @click="toggle(e)" :title="e.active ? 'Deactivate' : 'Activate'"><i class="bi" :class="e.active ? 'bi-pause' : 'bi-play'"></i></button>
            <button class="btn btn-sm btn-outline-danger" @click="remove(e)"><i class="bi bi-trash"></i></button></td>
        </tr></tbody></table></div>

      <modal-box :show="!!form" :title="form && form.id ? 'Edit examiner' : 'Add examiner'" @close="form=null">
        <form v-if="form" id="exForm" class="row g-3" @submit.prevent="save">
          <div class="col-md-6"><label class="form-label">Name *</label><input class="form-control" v-model.trim="form.name" required></div>
          <div class="col-md-6"><label class="form-label">Email *</label><input type="email" class="form-control" v-model.trim="form.email" required></div>
          <div class="col-md-6"><label class="form-label">{{ form.id ? 'New password' : 'Password *' }}</label><input type="password" class="form-control" v-model="form.password" :required="!form.id" minlength="6"></div>
          <div class="col-md-6"><label class="form-label">Phone</label><input class="form-control" v-model.trim="form.phone" pattern="[0-9+\\- ]{7,15}"></div>
          <div class="col-md-6"><label class="form-label">Department</label><input class="form-control" v-model="form.department"></div>
          <div class="col-md-6"><label class="form-label">Designation</label><input class="form-control" v-model="form.designation"></div>
          <div class="col-md-6" v-if="form.id"><label class="form-label">Availability</label><select class="form-select" v-model="form.examiner_status"><option>Active</option><option>On Leave</option><option>Inactive</option></select></div>
        </form>
        <template #footer><button class="btn btn-secondary" @click="form=null">Cancel</button><button class="btn btn-primary" form="exForm">Save</button></template>
      </modal-box>
    </div>`,
};

// --------------------------------------------------------------- Students
const AdminStudents = {
  data() { return { items: null, q: "", detail: null }; },
  created() { this.load(); },
  methods: {
    async load() { this.items = await api.get("/api/admin/students", { q: this.q }); },
    async toggle(s) { await api.put(`/api/admin/students/${s.id}`, { active: !s.active }); toast(s.active ? "Student deactivated" : "Student activated"); this.load(); },
    async view(s) { this.detail = await api.get(`/api/admin/students/${s.id}`); },
  },
  template: `
    <div class="container-fluid py-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0">Students</h3><input class="form-control w-auto" placeholder="Search name, email, roll no" v-model="q" @input="load">
      </div>
      <spinner v-if="!items"></spinner>
      <empty-state v-else-if="!items.length" text="No students"></empty-state>
      <div v-else class="table-responsive card shadow-sm"><table class="table table-hover mb-0">
        <thead class="table-light"><tr><th>Roll no</th><th>Name</th><th>Email</th><th class="d-none d-md-table-cell">Program</th><th>Bookings</th><th>Status</th><th></th></tr></thead>
        <tbody><tr v-for="s in items" :key="s.id" :class="{'opacity-50': !s.active}">
          <td>{{ s.roll_no }}</td><td class="fw-semibold">{{ s.name }}</td><td class="small">{{ s.email }}</td>
          <td class="d-none d-md-table-cell small">{{ s.program }} <span v-if="s.year">(Y{{ s.year }})</span></td><td>{{ s.booking_count }}</td>
          <td><status-badge :status="s.active ? 'Active' : 'Inactive'"></status-badge></td>
          <td class="text-end text-nowrap"><button class="btn btn-sm btn-outline-primary me-1" @click="view(s)"><i class="bi bi-eye"></i></button>
            <button class="btn btn-sm" :class="s.active ? 'btn-outline-warning' : 'btn-outline-success'" @click="toggle(s)"><i class="bi" :class="s.active ? 'bi-slash-circle' : 'bi-check-circle'"></i></button></td>
        </tr></tbody></table></div>
      <modal-box :show="!!detail" :title="detail ? detail.student.name + ' — examination history' : ''" size="lg" @close="detail=null">
        <template v-if="detail">
          <p class="small text-body-secondary">{{ detail.student.email }} · {{ detail.student.roll_no }} · {{ detail.student.program }}</p>
          <empty-state v-if="!detail.bookings.length" text="No bookings"></empty-state>
          <table v-else class="table table-sm"><thead><tr><th>Exam</th><th>Date</th><th>Examiner</th><th>Status</th><th>Marks</th></tr></thead>
            <tbody><tr v-for="b in detail.bookings"><td>{{ b.exam_name }}</td><td>{{ $fmt.date(b.date) }}</td><td>{{ b.examiner_name }}</td>
              <td><status-badge :status="b.status"></status-badge></td><td>{{ b.evaluation && b.evaluation.status==='Submitted' ? b.evaluation.total_marks : '–' }}</td></tr></tbody></table>
        </template>
      </modal-box>
    </div>`,
};

// ---------------------------------------------------------------- Reports
const AdminReports = {
  data() { return { r: null, palette: ["#0d6efd", "#198754", "#ffc107", "#dc3545", "#6f42c1", "#20c997", "#fd7e14", "#6c757d"] }; },
  async created() { this.r = await api.get("/api/admin/reports"); },
  methods: {
    async run(kind) {
      try { const res = await api.post(kind === "monthly" ? "/api/admin/reports/monthly" : "/api/admin/reminders/run"); toast(res.message); }
      catch (e) { toast(e.status === 500 ? "Celery/Redis not running" : e.message, "error"); }
    },
  },
  template: `
    <div class="container-fluid py-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0">Reports & analytics</h3>
        <div class="d-flex gap-2">
          <button class="btn btn-outline-primary" @click="run('reminders')"><i class="bi bi-bell"></i> Send reminders now</button>
          <button class="btn btn-primary" @click="run('monthly')"><i class="bi bi-envelope-paper"></i> Email monthly report now</button>
        </div>
      </div>
      <spinner v-if="!r"></spinner>
      <div v-else class="row g-3">
        <div class="col-lg-6"><div class="card shadow-sm"><div class="card-header bg-body">Popular examinations (bookings)</div><div class="card-body">
          <chart-box type="bar" :labels="r.popular_exams.labels" :datasets="[{label:'Bookings', data:r.popular_exams.data, backgroundColor:palette}]"></chart-box></div></div></div>
        <div class="col-lg-6"><div class="card shadow-sm"><div class="card-header bg-body">Examiner workload (students)</div><div class="card-body">
          <chart-box type="bar" :labels="r.examiner_workload.labels" :datasets="[{label:'Students', data:r.examiner_workload.data, backgroundColor:'#20c997'}]" :options="{indexAxis:'y'}"></chart-box></div></div></div>
        <div class="col-lg-8"><div class="card shadow-sm"><div class="card-header bg-body">Booking trend (last 30 days)</div><div class="card-body">
          <chart-box type="line" :labels="r.booking_trend.labels.map(d => d.slice(5))" :datasets="[{label:'Bookings', data:r.booking_trend.data, cubicInterpolationMode:'monotone', borderColor:'#0d6efd'}]"></chart-box></div></div></div>
        <div class="col-lg-4"><div class="card shadow-sm"><div class="card-header bg-body">Booking status</div><div class="card-body">
          <chart-box type="doughnut" :labels="Object.keys(r.booking_status)" :datasets="[{data:Object.values(r.booking_status), backgroundColor:palette}]"></chart-box></div></div></div>
        <div class="col-12"><div class="card shadow-sm"><div class="card-header bg-body">Average score by examination</div><div class="card-body">
          <chart-box type="bar" :labels="r.average_scores.map(a => a.exam)" :datasets="[{label:'Average', data:r.average_scores.map(a => a.average), backgroundColor:'#6f42c1'}, {label:'Maximum', data:r.average_scores.map(a => a.max), backgroundColor:'#dee2e6'}]" :options="{plugins:{legend:{display:true}}}"></chart-box></div></div></div>
      </div>
    </div>`,
};
