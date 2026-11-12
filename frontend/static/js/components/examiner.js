// --------------------------------------------------------------- Examiner
const ExaminerDashboard = {
  data() { return { d: null }; },
  async created() { try { this.d = await api.get("/api/examiner/dashboard"); } catch (e) { toast(e.message, "error"); } },
  template: `
    <div class="container-fluid py-4">
      <h3 class="mb-3">Examiner Dashboard</h3>
      <spinner v-if="!d"></spinner>
      <template v-else>
        <div class="row g-3 mb-4">
          <div class="col-6 col-lg-3"><stat-card label="Assigned examinations" :value="d.assigned_exams.length" icon="clipboard-check"></stat-card></div>
          <div class="col-6 col-lg-3"><stat-card label="Slots created" :value="d.slot_count" icon="calendar-week" color="info"></stat-card></div>
          <div class="col-6 col-lg-3"><stat-card label="Booked students" :value="d.booked_students" icon="people" color="success"></stat-card></div>
          <div class="col-6 col-lg-3"><stat-card label="Pending evaluations" :value="d.pending_evaluations" icon="hourglass-split" color="danger"></stat-card></div>
        </div>
        <div class="row g-3">
          <div class="col-lg-6"><div class="card shadow-sm h-100"><div class="card-header bg-body">Assigned examinations</div>
            <div class="list-group list-group-flush">
              <router-link v-for="e in d.assigned_exams" :key="e.id" :to="'/examiner/exams/' + e.id" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                <div><b>{{ e.name }}</b><div class="small text-body-secondary">{{ e.course_code }} · {{ e.exam_type }}</div></div>
                <status-badge :status="e.status"></status-badge></router-link>
              <div v-if="!d.assigned_exams.length" class="list-group-item text-body-secondary">No examinations assigned yet</div>
            </div></div></div>
          <div class="col-lg-6">
            <div class="card shadow-sm mb-3"><div class="card-header bg-body">Ready to evaluate</div>
              <div class="list-group list-group-flush">
                <router-link v-for="b in d.pending" :key="b.id" :to="'/examiner/evaluate/' + b.id" class="list-group-item list-group-item-action">
                  <b>{{ b.student_name }}</b> · {{ b.exam_name }}<div class="small text-body-secondary">{{ $fmt.date(b.date) }} {{ b.start_time }}</div></router-link>
                <div v-if="!d.pending.length" class="list-group-item text-body-secondary">All caught up 🎉</div>
              </div></div>
            <div class="card shadow-sm"><div class="card-header bg-body">Upcoming slots</div>
              <ul class="list-group list-group-flush">
                <li v-for="s in d.upcoming_slots" :key="s.id" class="list-group-item d-flex justify-content-between">
                  <span>{{ $fmt.date(s.date) }} {{ s.start_time }}–{{ s.end_time }}<div class="small text-body-secondary">{{ s.exam_name }}</div></span>
                  <span class="text-nowrap">{{ s.booked_count }}/{{ s.capacity }} <status-badge :status="s.status"></status-badge></span></li>
                <li v-if="!d.upcoming_slots.length" class="list-group-item text-body-secondary">No upcoming slots</li>
              </ul></div>
          </div>
        </div>
      </template>
    </div>`,
};

const ExaminerExams = {
  data() { return { items: null, q: "" }; },
  created() { this.load(); },
  methods: { async load() { this.items = await api.get("/api/exams", { q: this.q }); } },
  template: `
    <div class="container-fluid py-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0">My examinations</h3><input class="form-control w-auto" placeholder="Search" v-model="q" @input="load"></div>
      <spinner v-if="!items"></spinner>
      <empty-state v-else-if="!items.length" text="No examinations assigned"></empty-state>
      <div class="row g-3" v-else>
        <div class="col-md-6 col-xl-4" v-for="e in items" :key="e.id">
          <div class="card shadow-sm h-100"><div class="card-body">
            <div class="d-flex justify-content-between"><h5 class="card-title">{{ e.name }}</h5><status-badge :status="e.status"></status-badge></div>
            <p class="small text-body-secondary mb-2">{{ e.course_code }} · {{ e.exam_type }} · {{ e.duration }} min · {{ e.max_marks }} marks</p>
            <p class="small mb-1"><i class="bi bi-calendar-plus me-1"></i>Slot creation: {{ $fmt.date(e.slot_creation_start) }} → {{ $fmt.date(e.slot_creation_end) }}</p>
            <p class="small"><i class="bi bi-calendar-check me-1"></i>Booking: {{ $fmt.date(e.booking_start) }} → {{ $fmt.date(e.booking_end) }}</p>
          </div>
          <div class="card-footer bg-body"><router-link class="btn btn-primary btn-sm w-100" :to="'/examiner/exams/' + e.id">Manage slots & students</router-link></div></div>
        </div>
      </div>
    </div>`,
};

const ExaminerExamDetail = {
  props: ["id"],
  data() { return { data: null, form: null, studentsOf: null }; },
  computed: { editable() { return this.data && ["Draft", "Slot Creation"].includes(this.data.exam.status); } },
  created() { this.load(); },
  methods: {
    async load() {
      try { this.data = await api.get(`/api/examiner/exams/${this.id}/slots`); }
      catch (e) { toast(e.message, "error"); this.$router.push("/examiner/exams"); }
    },
    open(s) {
      this.form = s ? { ...s } : { date: "", start_time: "10:00", end_time: "", capacity: 1, meeting_link: "" };
      if (!s) this.autoEnd();
    },
    autoEnd() {
      if (!this.form.start_time || this.form.id) return;
      const [h, m] = this.form.start_time.split(":").map(Number);
      const t = h * 60 + m + this.data.exam.duration * Math.max(1, +this.form.capacity || 1);
      this.form.end_time = `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    },
    async save() {
      try {
        if (this.form.id) await api.put(`/api/examiner/slots/${this.form.id}`, this.form);
        else await api.post(`/api/examiner/exams/${this.id}/slots`, this.form);
        toast("Slot saved"); this.form = null; this.load();
      } catch (e) { toast(e.message, "error"); }
    },
    async remove(s) {
      if (!await askConfirm("Remove this slot?")) return;
      try { await api.del(`/api/examiner/slots/${s.id}`); toast("Slot removed"); this.load(); } catch (e) { toast(e.message, "error"); }
    },
    async saveLink(s) {
      const link = prompt("Meeting link (https://...)", s.meeting_link || "");
      if (link === null) return;
      try { await api.post(`/api/examiner/slots/${s.id}/meeting-link`, { meeting_link: link }); toast("Meeting link updated"); this.load(); }
      catch (e) { toast(e.message, "error"); }
    },
    async complete(s) {
      try { await api.post(`/api/examiner/slots/${s.id}/complete`); toast("Slot marked completed"); this.load(); } catch (e) { toast(e.message, "error"); }
    },
    async completeExam() {
      if (!await askConfirm("Mark all your slots for this examination as completed?")) return;
      try { const e = await api.post(`/api/examiner/exams/${this.id}/complete`); toast(`Done. Examination status: ${e.status}`); this.load(); }
      catch (e) { toast(e.message, "error"); }
    },
    async students(s) { this.studentsOf = await api.get(`/api/examiner/slots/${s.id}/bookings`); },
    async absent(b) {
      if (!await askConfirm(`Mark ${b.student_name} absent?`)) return;
      try { await api.post(`/api/examiner/bookings/${b.id}/absent`); this.students(this.studentsOf.slot); this.load(); } catch (e) { toast(e.message, "error"); }
    },
  },
  template: `
    <div class="container-fluid py-4">
      <spinner v-if="!data"></spinner>
      <template v-else>
        <router-link to="/examiner/exams" class="small"><i class="bi bi-arrow-left"></i> My examinations</router-link>
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mt-2 mb-3">
          <div><h3 class="mb-1">{{ data.exam.name }} <status-badge :status="data.exam.status"></status-badge></h3>
            <div class="text-body-secondary small">{{ data.exam.course_code }} · {{ data.exam.exam_type }} · {{ data.exam.duration }} min per student · slot creation {{ $fmt.date(data.exam.slot_creation_start) }} → {{ $fmt.date(data.exam.slot_creation_end) }}</div></div>
          <div class="d-flex gap-2">
            <button class="btn btn-primary" :disabled="!data.can_create" @click="open()"><i class="bi bi-plus-lg"></i> Add slot</button>
            <button class="btn btn-outline-dark" v-if="['Booking Open','Closed'].includes(data.exam.status)" @click="completeExam"><i class="bi bi-check2-all"></i> Mark exam completed</button>
          </div>
        </div>
        <div class="alert alert-info small py-2" v-if="!data.can_create">
          <i class="bi bi-info-circle"></i> Slot creation is {{ data.exam.status === 'Slot Creation' ? 'outside its date window' : 'closed by the admin' }}.
          <span v-if="editable">Existing slots without bookings can still be edited.</span>
          <span v-else>Slots are locked because student booking has begun.</span>
        </div>
        <div class="card shadow-sm mb-3"><div class="card-header bg-body">Rubric</div><div class="card-body small">
          <span v-for="r in data.exam.rubric" :key="r.id" class="badge text-bg-light border me-1 mb-1">{{ r.name }} — {{ r.max_marks }} marks ({{ r.weightage }}%)</span>
          <span v-if="!data.exam.rubric.length" class="text-body-secondary">Rubric not defined yet</span></div></div>
        <empty-state v-if="!data.slots.length" text="You have not created any slots for this examination" icon="calendar-x"></empty-state>
        <div v-else class="table-responsive card shadow-sm"><table class="table mb-0">
          <thead class="table-light"><tr><th>Date</th><th>Time</th><th>Seats</th><th>Meeting</th><th>Status</th><th></th></tr></thead>
          <tbody><tr v-for="s in data.slots" :key="s.id">
            <td>{{ $fmt.date(s.date) }}</td><td>{{ s.start_time }}–{{ s.end_time }}</td>
            <td>{{ s.booked_count }}/{{ s.capacity }}</td>
            <td><a v-if="s.meeting_link" :href="s.meeting_link" target="_blank" rel="noopener"><i class="bi bi-camera-video"></i></a>
              <button class="btn btn-link btn-sm p-0 ms-1" @click="saveLink(s)"><i class="bi bi-link-45deg"></i></button></td>
            <td><status-badge :status="s.status"></status-badge></td>
            <td class="text-end text-nowrap">
              <button class="btn btn-sm btn-outline-primary me-1" @click="students(s)"><i class="bi bi-people"></i> {{ s.booked_count }}</button>
              <template v-if="editable && !s.booked_count">
                <button class="btn btn-sm btn-outline-secondary me-1" @click="open(s)"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm btn-outline-danger" @click="remove(s)"><i class="bi bi-trash"></i></button></template>
              <button v-if="['Available','Full'].includes(s.status) && s.date <= $fmt.today() && !editable" class="btn btn-sm btn-outline-dark" @click="complete(s)">Complete</button>
            </td>
          </tr></tbody></table></div>
      </template>

      <modal-box :show="!!form" :title="form && form.id ? 'Edit slot' : 'Create slot'" @close="form=null">
        <form v-if="form" id="slotForm" class="row g-3" @submit.prevent="save">
          <div class="col-md-6"><label class="form-label">Date *</label><input type="date" class="form-control" v-model="form.date" :min="$fmt.today()" required></div>
          <div class="col-md-6"><label class="form-label">Max students *</label><input type="number" class="form-control" v-model="form.capacity" min="1" max="200" required @change="autoEnd"></div>
          <div class="col-6"><label class="form-label">Start time *</label><input type="time" class="form-control" v-model="form.start_time" required @change="autoEnd"></div>
          <div class="col-6"><label class="form-label">End time *</label><input type="time" class="form-control" v-model="form.end_time" required></div>
          <div class="col-12"><label class="form-label">Meeting link (optional)</label><input type="url" class="form-control" v-model.trim="form.meeting_link" placeholder="https://meet.google.com/..."></div>
          <div class="col-12 small text-body-secondary">End time is suggested from the exam duration × number of students.</div>
        </form>
        <template #footer><button class="btn btn-secondary" @click="form=null">Cancel</button><button class="btn btn-primary" form="slotForm">Save</button></template>
      </modal-box>

      <modal-box :show="!!studentsOf" title="Booked students" size="lg" @close="studentsOf=null">
        <template v-if="studentsOf">
          <p class="small text-body-secondary">{{ $fmt.date(studentsOf.slot.date) }} {{ studentsOf.slot.start_time }}–{{ studentsOf.slot.end_time }}</p>
          <empty-state v-if="!studentsOf.bookings.length" text="No students booked"></empty-state>
          <table v-else class="table"><thead><tr><th>Student</th><th>Roll no</th><th>Status</th><th>Marks</th><th></th></tr></thead>
            <tbody><tr v-for="b in studentsOf.bookings" :key="b.id"><td>{{ b.student_name }}<div class="small text-body-secondary">{{ b.student_email }}</div></td><td>{{ b.roll_no }}</td>
              <td><status-badge :status="b.status"></status-badge></td><td>{{ b.evaluation ? b.evaluation.total_marks + (b.evaluation.status==='Draft' ? ' (draft)' : '') : '–' }}</td>
              <td class="text-end text-nowrap"><router-link v-if="['Booked','Completed'].includes(b.status)" class="btn btn-sm btn-primary me-1" :to="'/examiner/evaluate/' + b.id">Evaluate</router-link>
                <button v-if="b.status==='Booked'" class="btn btn-sm btn-outline-danger" @click="absent(b)">Absent</button></td></tr></tbody></table>
        </template>
      </modal-box>
    </div>`,
};

const ExaminerEvaluations = {
  data() { return { items: null, exams: [], f: { exam_id: "", status: "Booked" } }; },
  async created() { this.load(); this.exams = await api.get("/api/exams"); },
  methods: { async load() { this.items = await api.get("/api/examiner/bookings", this.f); } },
  template: `
    <div class="container-fluid py-4">
      <h3>Evaluations</h3>
      <div class="row g-2 mb-3">
        <div class="col-md-5"><select class="form-select" v-model="f.exam_id" @change="load"><option value="">All my examinations</option><option v-for="e in exams" :value="e.id">{{ e.name }}</option></select></div>
        <div class="col-md-3"><select class="form-select" v-model="f.status" @change="load"><option value="Booked">Pending</option><option value="Completed">Evaluated</option><option value="Absent">Absent</option><option value="">All</option></select></div>
      </div>
      <spinner v-if="!items"></spinner>
      <empty-state v-else-if="!items.length" text="Nothing to show" icon="check2-circle"></empty-state>
      <div v-else class="table-responsive card shadow-sm"><table class="table table-hover mb-0">
        <thead class="table-light"><tr><th>Student</th><th>Examination</th><th>Slot</th><th>Status</th><th>Marks</th><th></th></tr></thead>
        <tbody><tr v-for="b in items" :key="b.id">
          <td>{{ b.student_name }}<div class="small text-body-secondary">{{ b.roll_no }}</div></td><td>{{ b.exam_name }}</td>
          <td>{{ $fmt.date(b.date) }} {{ b.start_time }}</td><td><status-badge :status="b.status"></status-badge></td>
          <td>{{ b.evaluation ? b.evaluation.total_marks + (b.evaluation.status==='Draft' ? ' (draft)' : '') : '–' }}</td>
          <td class="text-end"><router-link v-if="b.status!=='Absent'" class="btn btn-sm" :class="b.evaluated ? 'btn-outline-primary' : 'btn-primary'" :to="'/examiner/evaluate/' + b.id">{{ b.evaluated ? 'View / edit' : 'Evaluate' }}</router-link></td>
        </tr></tbody></table></div>
    </div>`,
};

const ExaminerEvaluate = {
  props: ["id"],
  data() { return { data: null, scores: {}, remarks: "", saving: false }; },
  computed: {
    rubric() { return this.data ? this.data.exam.rubric : []; },
    total() {
      const w = this.rubric.reduce((a, c) => a + (c.weightage || 0), 0);
      if (!w) return this.rubric.reduce((a, c) => a + (+this.scores[c.id].marks || 0), 0).toFixed(2);
      const s = this.rubric.reduce((a, c) => a + ((+this.scores[c.id].marks || 0) / c.max_marks) * (c.weightage || 0), 0);
      return (s / w * this.data.exam.max_marks).toFixed(2);
    },
    locked() { return this.data && this.data.exam.results_published; },
  },
  async created() {
    try {
      this.data = await api.get(`/api/examiner/bookings/${this.id}/evaluation`);
      const ev = this.data.booking.evaluation;
      for (const c of this.data.exam.rubric) {
        const s = ev && ev.scores.find((x) => x.criterion_id === c.id);
        this.scores[c.id] = { marks: s ? s.marks : "", comment: s ? s.comment : "" };
      }
      this.remarks = ev ? ev.remarks || "" : "";
    } catch (e) { toast(e.message, "error"); this.$router.push("/examiner/evaluations"); }
  },
  methods: {
    async save(submit) {
      if (submit && !this.$refs.form.reportValidity()) return;
      this.saving = true;
      try {
        const scores = Object.entries(this.scores).filter(([, s]) => s.marks !== "" && s.marks !== null)
          .map(([cid, s]) => ({ criterion_id: +cid, marks: +s.marks, comment: s.comment }));
        await api.post(`/api/examiner/bookings/${this.id}/evaluation`, { scores, remarks: this.remarks, submit });
        toast(submit ? "Evaluation submitted" : "Draft saved");
        if (submit) this.$router.push("/examiner/evaluations");
      } catch (e) { toast(e.message, "error"); }
      this.saving = false;
    },
  },
  template: `
    <div class="container py-4" style="max-width:860px">
      <spinner v-if="!data"></spinner>
      <template v-else>
        <a href="#" class="small" @click.prevent="$router.back()"><i class="bi bi-arrow-left"></i> Back</a>
        <div class="card shadow-sm mt-2">
          <div class="card-header bg-body">
            <h4 class="mb-0">{{ data.booking.student_name }} <small class="text-body-secondary">{{ data.booking.roll_no }}</small></h4>
            <div class="small text-body-secondary">{{ data.exam.name }} · {{ $fmt.date(data.booking.date) }} {{ data.booking.start_time }} · <status-badge :status="data.booking.status"></status-badge></div>
          </div>
          <div class="card-body">
            <div class="alert alert-warning py-2 small" v-if="locked">Results are published — this evaluation is read-only.</div>
            <div class="alert alert-warning py-2 small" v-if="!rubric.length">The admin has not defined a rubric for this examination yet.</div>
            <form ref="form" @submit.prevent="save(true)">
              <fieldset :disabled="locked">
              <div class="row g-2 align-items-center border-bottom py-2" v-for="c in rubric" :key="c.id">
                <div class="col-md-5"><b>{{ c.name }}</b> <span class="badge text-bg-light border">{{ c.weightage }}%</span><div class="small text-body-secondary">{{ c.description }}</div></div>
                <div class="col-4 col-md-2"><div class="input-group input-group-sm">
                  <input type="number" class="form-control" v-model="scores[c.id].marks" min="0" :max="c.max_marks" step="0.5" required>
                  <span class="input-group-text">/{{ c.max_marks }}</span></div></div>
                <div class="col-8 col-md-5"><input class="form-control form-control-sm" v-model="scores[c.id].comment" placeholder="Comment (optional)" maxlength="300"></div>
              </div>
              <div class="mt-3"><label class="form-label">Overall remarks / feedback</label>
                <textarea class="form-control" rows="3" v-model="remarks" maxlength="2000"></textarea></div>
              </fieldset>
              <div class="d-flex flex-wrap justify-content-between align-items-center mt-3 gap-2">
                <div class="fs-5">Total: <b>{{ total }}</b> / {{ data.exam.max_marks }}</div>
                <div v-if="!locked" class="d-flex gap-2">
                  <button type="button" class="btn btn-outline-secondary" :disabled="saving" @click="save(false)">Save draft</button>
                  <button class="btn btn-success" :disabled="saving || !rubric.length"><i class="bi bi-send"></i> Submit evaluation</button></div>
              </div>
            </form>
          </div>
        </div>
      </template>
    </div>`,
};
