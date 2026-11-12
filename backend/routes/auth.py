from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token

from extensions import db
from models import User, StudentProfile
from utils import (ApiError, role_required, require, validate_email, validate_password, parse_number)

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _token_response(user):
    token = create_access_token(identity=str(user.id), additional_claims={"role": user.role})
    return jsonify({"access_token": token, "user": user.to_dict()})


@bp.post("/register")
def register():
    """Only students can self-register."""
    data = request.get_json() or {}
    require(data, "name", "email", "password", "roll_no")
    email = validate_email(data["email"])
    validate_password(data["password"])
    if User.query.filter_by(email=email).first():
        raise ApiError("An account with this email already exists", 409)
    if StudentProfile.query.filter_by(roll_no=data["roll_no"].strip()).first():
        raise ApiError("This roll number is already registered", 409)

    user = User(email=email, name=data["name"].strip(), phone=data.get("phone"), role="student")
    user.set_password(data["password"])
    year = parse_number(data["year"], "year", int, 1, 6) if data.get("year") else None
    user.student_profile = StudentProfile(roll_no=data["roll_no"].strip(), program=data.get("program"), year=year)
    db.session.add(user)
    db.session.commit()
    return _token_response(user), 201


@bp.post("/login")
def login():
    data = request.get_json() or {}
    require(data, "email", "password")
    user = User.query.filter_by(email=data["email"].strip().lower()).first()
    if not user or not user.check_password(data["password"]):
        raise ApiError("Invalid email or password", 401)
    if not user.active:
        raise ApiError("Your account has been deactivated. Contact the administrator.", 403)
    return _token_response(user)


@bp.get("/me")
@role_required()
def me(user):
    return jsonify(user.to_dict())


@bp.put("/profile")
@role_required()
def update_profile(user):
    data = request.get_json() or {}
    if "name" in data:
        if not data["name"].strip():
            raise ApiError("Name cannot be empty")
        user.name = data["name"].strip()
    if "phone" in data:
        phone = (data["phone"] or "").strip()
        if phone and not phone.replace("+", "").replace("-", "").replace(" ", "").isdigit():
            raise ApiError("Phone number may contain only digits, spaces, + and -")
        user.phone = phone
    if data.get("new_password"):
        if not user.check_password(data.get("current_password", "")):
            raise ApiError("Current password is incorrect")
        user.set_password(validate_password(data["new_password"]))

    if user.role == "student" and user.student_profile:
        if "program" in data:
            user.student_profile.program = data["program"]
        if data.get("year"):
            user.student_profile.year = parse_number(data["year"], "year", int, 1, 6)
    if user.role == "examiner" and user.examiner_profile:
        if "department" in data:
            user.examiner_profile.department = data["department"]
        if "designation" in data:
            user.examiner_profile.designation = data["designation"]
    db.session.commit()
    return jsonify(user.to_dict())
