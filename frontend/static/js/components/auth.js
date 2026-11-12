const homeFor = (role) => ({ admin: "/admin", examiner: "/examiner", student: "/student" }[role] || "/login");

const LoginPage = {
  data() { return { email: "", password: "", loading: false, error: "" }; },
  methods: {
    async submit() {
      this.loading = true; this.error = "";
      try {
        const res = await api.post("/api/auth/login", { email: this.email, password: this.password });
        setSession(res.access_token, res.user);
        toast(`Welcome back, ${res.user.name}!`);
        this.$router.push(this.$route.query.next || homeFor(res.user.role));
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
  },
  template: `
    <div class="auth-wrap d-flex align-items-center justify-content-center p-3">
      <div class="card shadow-sm w-100" style="max-width:420px">
        <div class="card-body p-4">
          <div class="text-center mb-4">
            <i class="bi bi-mortarboard-fill text-primary" style="font-size:3rem"></i>
            <h4 class="mt-2 mb-0">Examination Management Portal</h4>
            <small class="text-body-secondary">Sign in as Admin, Examiner or Student</small>
          </div>
          <div class="alert alert-danger py-2" v-if="error">{{ error }}</div>
          <form @submit.prevent="submit">
            <div class="mb-3"><label class="form-label">Email</label>
              <input type="email" class="form-control" v-model.trim="email" required autofocus></div>
            <div class="mb-3"><label class="form-label">Password</label>
              <input type="password" class="form-control" v-model="password" required></div>
            <button class="btn btn-primary w-100" :disabled="loading">
              <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>Login</button>
          </form>
          <p class="text-center mt-3 mb-0 small">New student? <router-link to="/register">Create an account</router-link></p>
        </div>
      </div>
    </div>`,
};

const RegisterPage = {
  data() {
    return { form: { name: "", email: "", password: "", confirm: "", roll_no: "", program: "", year: "", phone: "" },
             loading: false, error: "" };
  },
  methods: {
    async submit() {
      if (this.form.password !== this.form.confirm) { this.error = "Passwords do not match"; return; }
      this.loading = true; this.error = "";
      try {
        const res = await api.post("/api/auth/register", this.form);
        setSession(res.access_token, res.user);
        toast("Registration successful. Welcome!");
        this.$router.push("/student");
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
  },
  template: `
    <div class="auth-wrap d-flex align-items-center justify-content-center p-3">
      <div class="card shadow-sm w-100" style="max-width:560px">
        <div class="card-body p-4">
          <h4 class="mb-1">Student Registration</h4>
          <p class="text-body-secondary small">Admins and examiners are created by the administrator.</p>
          <div class="alert alert-danger py-2" v-if="error">{{ error }}</div>
          <form class="row g-3" @submit.prevent="submit">
            <div class="col-md-6"><label class="form-label">Full name *</label><input class="form-control" v-model.trim="form.name" required minlength="2" maxlength="100"></div>
            <div class="col-md-6"><label class="form-label">Roll number *</label><input class="form-control" v-model.trim="form.roll_no" required pattern="[A-Za-z0-9]{4,20}" title="4-20 letters/digits"></div>
            <div class="col-md-6"><label class="form-label">Email *</label><input type="email" class="form-control" v-model.trim="form.email" required></div>
            <div class="col-md-6"><label class="form-label">Phone</label><input class="form-control" v-model.trim="form.phone" pattern="[0-9+\\- ]{7,15}" title="7-15 digits"></div>
            <div class="col-md-8"><label class="form-label">Program</label><input class="form-control" v-model.trim="form.program" maxlength="100" placeholder="e.g. BS Data Science"></div>
            <div class="col-md-4"><label class="form-label">Year</label><input type="number" class="form-control" v-model="form.year" min="1" max="6"></div>
            <div class="col-md-6"><label class="form-label">Password *</label><input type="password" class="form-control" v-model="form.password" required minlength="6"></div>
            <div class="col-md-6"><label class="form-label">Confirm password *</label><input type="password" class="form-control" v-model="form.confirm" required minlength="6"></div>
            <div class="col-12"><button class="btn btn-primary w-100" :disabled="loading">
              <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>Register</button></div>
          </form>
          <p class="text-center mt-3 mb-0 small">Already registered? <router-link to="/login">Login</router-link></p>
        </div>
      </div>
    </div>`,
};
