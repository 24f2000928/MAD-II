// ---------------------------------------------------------------- Student

// Async CSV export: start the Celery job, poll its state, then download.
const ExportButton = {
  data() { return { busy: false }; },
  methods: {
    async start() {
      this.busy = true;
      try {
        const { task_id, message } = await api.post("/api/student/export");
        toast(message, "info");
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const s = await api.get(`/api/student/export/${task_id}`);
          if (s.state === "SUCCESS") {
            toast("Export ready - downloading");
            await api.download(`/api/student/exports/${s.file}`, s.file);
            break;
          }
          if (s.state === "FAILURE") { toast("Export failed", "error"); break; }
        }
      } catch (e) { toast(e.message, "error"); }
      this.busy = false;
    },
  },
  template: `<button class="btn btn-outline-primary" :disabled="busy" @click="start">
      <span v-if="busy" class="spinner-border spinner-border-sm me-1"></span><i v-else class="bi bi-filetype-csv me-1"></i>Export history (CSV)</button>`,
};

const StudentDashboard = {
  components: { ExportButton },
  setup() { return { store }; },
  data() { return { d: null }; },
  async created() { try { this.d = await api.get("/api/student/dashboard"); } catch (e) { toast(e.message, "error"); } },
  template: `
    <div class="container-fluid py-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0">Hi, {{ store.user.name.split(' ')[0] }} 👋</h3><export-button></export-button></div>
      <spinner v-if="!d"></spinner>
      <template v-else>
        <div class="row g-3 mb-4">
          <div class="col-6 col-lg-3"><stat-card label="Exams open for booking" :value="d.available_exams.length" icon="clipboard-check"></stat-card></div>
          <div class="col-6 col-lg-3"><stat-card label="Available slots" :value="d.available_slot_count" icon="calendar-week" color="info"></stat-card></div>
          <div class="col-6 col-lg-3"><stat-card label="Booked slots" :value="d.booked_count" icon="bookmark-check" color="success"></stat-card></div>
          <div class="col-6 col-lg-3"><stat-card label="Published results" :value="d.result_count" icon="award" color="warning"></stat-card></div>
        </div>
        <div class="row g-3">
          <div class="col-lg-6"><div class="card shadow-sm h-100"><div class="card-header bg-body d-flex justify-content-between">Upcoming examinations <router-link to="/student/bookings" class="small">All bookings</router-link></div>
            <ul class="list-group list-group-flush">
              <li class="list-group-item" v-for="b in d.upcoming" :key="b.id">
                <div class="d-flex justify-content-between"><b>{{ b.exam_name }}</b><span class="small">{{ $fmt.date(b.date) }}</span></div>
                <div class="small text-body-secondary">{{ b.start_time }}–{{ b.end_time }} · {{ b.examiner_name }}
                  <a v-if="b.meeting_link" :href="b.meeting_link" target="_blank" rel="noopener" class="ms-1"><i class="bi bi-camera-video"></i> Join</a></div></li>
              <li v-if="!d.upcoming.length" class="list-group-item text-body-secondary">No upcoming examinations</li>
            </ul></div></div>
          <div class="col-lg-6"><div class="card shadow-sm h-100"><div class="card-header bg-body d-flex justify-content-between">Open for booking <router-link to="/student/exams" class="small">Browse all</router-link></div>
            <div class="list-group list-group-flush">
              <router-link v-for="e in d.available_exams" :key="e.id" :to="{path:'/student/exams', query:{book:e.id}}" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                <div><b>{{ e.name }}</b><div class="small text-body-secondary">{{ e.course_code }} · {{ e.exam_type }} · book by {{ $fmt.date(e.booking_end) }}</div></div>
                <span v-if="e.booked" class="badge text-bg-success">Booked</span><span v-else class="btn btn-sm btn-primary">Book</span></router-link>
              <div v-if="!d.available_exams.length" class="list-group-item text-body-secondary">No examinations open for booking right now</div>
            </div></div></div>
          <div class="col-12"><div class="card shadow-sm"><div class="card-header bg-body d-flex justify-content-between">Recent results <router-link to="/student/results" class="small">All results</router-link></div>
            <ul class="list-group list-group-flush">
              <li class="list-group-item d-flex justify-content-between" v-for="b in d.results" :key="b.id"><span>{{ b.exam_name }} <small class="text-body-secondary">{{ b.course_code }}</small></span>
                <b>{{ b.evaluation.total_marks }} / {{ b.max_marks }}</b></li>
              <li v-if="!d.results.length" class="list-group-item text-body-secondary">No published results yet</li>
            </ul></div></div>
        </div>
      </template>
    </div>`,
};

const StudentExams = {
  data() {
    return { items: null, courses: [], f: { q: "", course_id: "", type: "", status: "" }, sel: null, slots: [], booking: false,
             EXAM_TYPES, statuses: ["Slot Creation", "Booking Open", "Closed", "Completed"] };
  },
  async created() {
    this.courses = await api.get("/api/courses");
    await this.load();
    if (this.$route.query.book) { const e = this.items.find((x) => x.id === +this.$route.query.book); if (e) this.open(e); }
  },
  methods: {
    async load() { this.items = await api.get("/api/student/exams", this.f); },
    inWindow(e) {
      const t = fmt.today();
      return (!e.booking_start || e.booking_start <= t) && (!e.booking_end || t <= e.booking_end);
    },
    async open(e) { this.sel = e; this.slots = null; this.slots = await api.get(`/api/exams/${e.id}/slots`); },
    async book(s) {
      if (!await askConfirm(`Book ${this.sel.name} on ${s.date} at ${s.start_time} with ${s.examiner_name}?`)) return;
      this.booking = true;
      try {
        await api.post("/api/student/bookings", { slot_id: s.id });
        toast("Slot booked successfully! A confirmation is in your notifications.");
        this.sel = null; this.load();
      } catch (e) { toast(e.message, "error"); if (this.sel) this.open(this.sel); }
      this.booking = false;
    },
  },
  template: `
    <div class="container-fluid py-4">
      <h3>Examinations</h3>
      <div class="row g-2 mb-3">
        <div class="col-md-4"><input class="form-control" placeholder="Search by name, course or type" v-model="f.q" @input="load"></div>
        <div class="col-md-3"><select class="form-select" v-model="f.course_id" @change="load"><option value="">All courses</option><option v-for="c in courses" :value="c.id">{{ c.code }} - {{ c.name }}</option></select></div>
        <div class="col-6 col-md-2"><select class="form-select" v-model="f.type" @change="load"><option value="">All types</option><option v-for="t in EXAM_TYPES">{{ t }}</option></select></div>
        <div class="col-6 col-md-3"><select class="form-select" v-model="f.status" @change="load"><option value="">Any status</option><option v-for="s in statuses">{{ s }}</option></select></div>
      </div>
      <spinner v-if="!items"></spinner>
      <empty-state v-else-if="!items.length" text="No examinations match your search" icon="search"></empty-state>
      <div class="row g-3" v-else>
        <div class="col-md-6 col-xl-4" v-for="e in items" :key="e.id">
          <div class="card shadow-sm h-100"><div class="card-body">
            <div class="d-flex justify-content-between"><h5 class="card-title mb-1">{{ e.name }}</h5><status-badge :status="e.status"></status-badge></div>
            <p class="small text-body-secondary">{{ e.course_code }} · {{ e.course_name }}</p>
            <p class="small mb-1"><i class="bi bi-tag me-1"></i>{{ e.exam_type }} · {{ e.duration }} min · {{ e.max_marks }} marks</p>
            <p class="small mb-1"><i class="bi bi-calendar-range me-1"></i>Booking {{ $fmt.date(e.booking_start) }} → {{ $fmt.date(e.booking_end) }}</p>
            <p class="small mb-0"><i class="bi bi-person-badge me-1"></i>{{ e.examiners.map(x => x.name).join(', ') || '—' }}</p>
          </div>
          <div class="card-footer bg-body">
            <span v-if="e.booked" class="text-success small"><i class="bi bi-check-circle-fill"></i> You have booked this examination</span>
            <button v-else-if="e.status==='Booking Open'" class="btn btn-primary btn-sm w-100" @click="open(e)">View slots & book</button>
            <button v-else class="btn btn-outline-secondary btn-sm w-100" @click="open(e)">View schedule</button>
          </div></div>
        </div>
      </div>

      <modal-box :show="!!sel" :title="sel ? sel.name : ''" size="lg" @close="sel=null">
        <template v-if="sel">
          <p class="small" style="white-space:pre-line" v-if="sel.instructions"><b>Instructions:</b> {{ sel.instructions }}</p>
          <div class="alert alert-info small py-2" v-if="sel.status!=='Booking Open'">Booking is not open for this examination (status: {{ sel.status }}).</div>
          <div class="alert alert-warning small py-2" v-else-if="!inWindow(sel)">Booking is only allowed from {{ $fmt.date(sel.booking_start) }} to {{ $fmt.date(sel.booking_end) }}.</div>
          <spinner v-if="!slots"></spinner>
          <empty-state v-else-if="!slots.length" text="No slots published yet" icon="calendar-x"></empty-state>
          <div v-else class="table-responsive"><table class="table align-middle">
            <thead><tr><th>Date</th><th>Time</th><th>Examiner</th><th>Seats left</th><th></th></tr></thead>
            <tbody><tr v-for="s in slots" :key="s.id">
              <td>{{ $fmt.date(s.date) }}</td><td>{{ s.start_time }}–{{ s.end_time }}</td><td>{{ s.examiner_name }}</td>
              <td><span :class="s.available_seats ? 'text-success' : 'text-danger'">{{ s.available_seats }}/{{ s.capacity }}</span></td>
              <td class="text-end"><button v-if="s.status==='Available' && sel.status==='Booking Open' && inWindow(sel) && !sel.booked" class="btn btn-sm btn-success" :disabled="booking" @click="book(s)">Book</button>
                <status-badge v-else :status="s.status"></status-badge></td>
            </tr></tbody></table></div>
        </template>
      </modal-box>
    </div>`,
};

const StudentBookings = {
  components: { ExportButton },
  data() { return { items: null, status: "" }; },
  created() { this.load(); },
  methods: {
    async load() { this.items = await api.get("/api/student/bookings", { status: this.status }); },
    canCancel(b) { return b.status === "Booked" && b.exam_status === "Booking Open"; },
    async cancel(b) {
      if (!await askConfirm(`Cancel your booking for ${b.exam_name}?`)) return;
      try { await api.post(`/api/student/bookings/${b.id}/cancel`); toast("Booking cancelled", "warning"); this.load(); }
      catch (e) { toast(e.message, "error"); }
    },
  },
  template: `
    <div class="container-fluid py-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0">My bookings & history</h3>
        <div class="d-flex gap-2"><select class="form-select" v-model="status" @change="load"><option value="">All</option><option>Booked</option><option>Completed</option><option>Cancelled</option><option>Absent</option></select>
          <export-button></export-button></div>
      </div>
      <spinner v-if="!items"></spinner>
      <empty-state v-else-if="!items.length" text="No bookings yet" icon="bookmark"></empty-state>
      <div v-else class="table-responsive card shadow-sm"><table class="table table-hover mb-0">
        <thead class="table-light"><tr><th>Examination</th><th>Date & time</th><th>Examiner</th><th>Booking</th><th>Exam status</th><th>Marks</th><th></th></tr></thead>
        <tbody><tr v-for="b in items" :key="b.id">
          <td class="fw-semibold">{{ b.exam_name }}<div class="small text-body-secondary">{{ b.course_code }} · {{ b.exam_type }}</div></td>
          <td class="text-nowrap">{{ $fmt.date(b.date) }}<div class="small">{{ b.start_time }}–{{ b.end_time }}
            <a v-if="b.meeting_link && b.status==='Booked'" :href="b.meeting_link" target="_blank" rel="noopener"><i class="bi bi-camera-video"></i></a></div></td>
          <td>{{ b.examiner_name }}</td><td><status-badge :status="b.status"></status-badge></td>
          <td><status-badge :status="b.exam_status"></status-badge></td>
          <td>{{ b.evaluation ? b.evaluation.total_marks : (b.evaluated ? 'Awaiting publish' : '–') }}</td>
          <td class="text-end"><button v-if="canCancel(b)" class="btn btn-sm btn-outline-danger" @click="cancel(b)">Cancel</button>
            <router-link v-if="b.evaluation" class="btn btn-sm btn-outline-primary" :to="'/student/scorecard/' + b.id">Scorecard</router-link></td>
        </tr></tbody></table></div>
      <p class="small text-body-secondary mt-2">Bookings can be cancelled only while booking is open and before the booking deadline.</p>
    </div>`,
};

const StudentResults = {
  data() { return { items: null }; },
  async created() { this.items = await api.get("/api/student/results"); },
  template: `
    <div class="container-fluid py-4">
      <h3>Published results</h3>
      <spinner v-if="!items"></spinner>
      <empty-state v-else-if="!items.length" text="No results have been published yet" icon="award"></empty-state>
      <div class="row g-3" v-else>
        <div class="col-md-6" v-for="b in items" :key="b.id">
          <div class="card shadow-sm h-100"><div class="card-body">
            <div class="d-flex justify-content-between align-items-start">
              <div><h5 class="mb-0">{{ b.exam_name }}</h5><small class="text-body-secondary">{{ b.course_code }} · {{ $fmt.date(b.date) }} · {{ b.examiner_name }}</small></div>
              <div class="text-end"><div class="fs-4 fw-bold text-primary">{{ b.evaluation.total_marks }}<small class="fs-6 text-body-secondary"> / {{ b.max_marks }}</small></div></div>
            </div>
            <table class="table table-sm mt-3 mb-2"><tbody>
              <tr v-for="s in b.evaluation.scores" :key="s.criterion_id"><td>{{ s.criterion_name }}<div class="small text-body-secondary" v-if="s.comment">{{ s.comment }}</div></td>
                <td class="text-end text-nowrap">{{ s.marks }} / {{ s.max_marks }}</td></tr></tbody></table>
            <p class="small mb-2" v-if="b.evaluation.remarks"><i class="bi bi-chat-quote me-1"></i><b>Feedback:</b> {{ b.evaluation.remarks }}</p>
            <router-link class="btn btn-sm btn-outline-primary" :to="'/student/scorecard/' + b.id"><i class="bi bi-file-earmark-text"></i> Scorecard</router-link>
          </div></div>
        </div>
      </div>
    </div>`,
};

// Printable scorecard ("Save as PDF" from the print dialog)
const StudentScorecard = {
  props: ["id"],
  setup() { return { store }; },
  data() { return { b: null, exam: null }; },
  async created() {
    const all = await api.get("/api/student/results");
    this.b = all.find((x) => x.id === +this.id);
    if (!this.b) { toast("Scorecard not available", "error"); return this.$router.push("/student/results"); }
    this.exam = await api.get(`/api/exams/${this.b.exam_id}`);
  },
  template: `
    <div class="container py-4" style="max-width:800px">
      <spinner v-if="!exam"></spinner>
      <template v-else>
        <div class="d-flex justify-content-between mb-3 no-print">
          <a href="#" @click.prevent="$router.back()"><i class="bi bi-arrow-left"></i> Back</a>
          <button class="btn btn-primary" onclick="window.print()"><i class="bi bi-printer"></i> Print / Save as PDF</button></div>
        <div class="card shadow-sm print-area"><div class="card-body p-4">
          <div class="d-flex justify-content-between border-bottom pb-3 mb-3">
            <div><h4 class="mb-0"><i class="bi bi-mortarboard-fill text-primary"></i> Examination Scorecard</h4><small class="text-body-secondary">Examination Management Portal</small></div>
            <div class="text-end small">Issued {{ $fmt.date($fmt.today()) }}<br>Ref #EMP-{{ b.id }}</div></div>
          <div class="row small mb-3">
            <div class="col-6"><b>Student:</b> {{ store.user.name }}<br><b>Roll no:</b> {{ b.roll_no }}<br><b>Email:</b> {{ b.student_email }}</div>
            <div class="col-6"><b>Examination:</b> {{ exam.name }} ({{ exam.exam_type }})<br><b>Course:</b> {{ exam.course_code }} - {{ exam.course_name }}<br>
              <b>Date:</b> {{ $fmt.date(b.date) }} {{ b.start_time }} · <b>Examiner:</b> {{ b.examiner_name }}</div></div>
          <table class="table table-bordered">
            <thead class="table-light"><tr><th>Criterion</th><th class="text-center">Weightage</th><th class="text-center">Marks</th><th>Comment</th></tr></thead>
            <tbody><tr v-for="s in b.evaluation.scores" :key="s.criterion_id"><td>{{ s.criterion_name }}</td><td class="text-center">{{ s.weightage }}%</td>
              <td class="text-center">{{ s.marks }} / {{ s.max_marks }}</td><td class="small">{{ s.comment }}</td></tr></tbody>
            <tfoot><tr class="table-primary"><th colspan="2">Total (weighted)</th><th class="text-center">{{ b.evaluation.total_marks }} / {{ exam.max_marks }}</th>
              <th>{{ Math.round(b.evaluation.total_marks / exam.max_marks * 100) }}%</th></tr></tfoot></table>
          <p v-if="b.evaluation.remarks"><b>Examiner remarks:</b> {{ b.evaluation.remarks }}</p>
          <p class="small text-body-secondary mb-0">Evaluated on {{ $fmt.datetime(b.evaluation.evaluated_at) }}. This is a system-generated scorecard.</p>
        </div></div>
      </template>
    </div>`,
};
