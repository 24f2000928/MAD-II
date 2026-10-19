import os

from flask import Flask, config, render_template, send_from_directory, jsonify

from config import Config, BASE_DIR
from extensions import db, jwt, cache
from utils import ApiError

FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))

def _redis_available(url):
    try:
        import redis
        redis.Redis.from_url(url, socket_connect_timeout=1).ping()
        return True
    except Exception:
        return False

def create_admin():
    from models import User
    if not User.query.filter_by(role="admin").first():
        admin = User(email=Config.ADMIN_EMAIL, name = Config.ADMIN_NAME, role="admin")
        admin.set_password(Config.ADMIN_PASSWORD)
        db.session.add(admin)
        db.session.commit()

def create_app(config = Config):
    app = Flask(__name__, template_folder=FRONTEND_DIR,
                static_folder=os.path.join(FRONTEND_DIR, "static"), static_url_path="/static")
    app.config.from_object(config)
    os.makedirs(os.path.join(BASE_DIR, "instance"), exist_ok=True)
    os.makedirs(app.config["EXPORT_DIR"], exist_ok=True)

    if app.config["CACHE_TYPE"] == "RedisCache" and not _redis_available(app.config["CACHE_REDIS_URL"]):
        app.logger.warning("Redis not reachable - falling back to in-process SimpleCache")
        app.config["CACHE_TYPE"] = "SimpleCache"

    db.init_app(app)
    jwt.init_app(app)
    cache.init_app(app)

    from routes.auth import bp as auth_bp
    from routes.common import bp as common_bp
    from routes.admin import bp as admin_bp
    from routes.examiner import bp as examiner_bp
    from routes.student import bp as student_bp
    for bp in (auth_bp, common_bp, admin_bp, examiner_bp, student_bp):
        app.register_blueprint(bp)

    @app.errorhandler(ApiError)
    def handle_api_error(e):
        return jsonify({"message": e.message}), e.status

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"message": "Resource not found"}), 404

    @jwt.unauthorized_loader
    def missing_token(reason):
        return jsonify({"message": "Please log in to continue"}), 401

    @jwt.invalid_token_loader
    def bad_token(reason):
        return jsonify({"message": "Invalid session, please log in again"}), 401

    @jwt.expired_token_loader
    def expired_token(header, payload):
        return jsonify({"message": "Session expired, please log in again"}), 401

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/manifest.json")
    def manifest():
        return send_from_directory(FRONTEND_DIR, "manifest.json")

    @app.route("/sw.js")
    def service_worker():
        return send_from_directory(FRONTEND_DIR, "sw.js", mimetype="application/javascript")

    with app.app_context():
        import models
        db.create_all()
        create_admin()

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
