const mongoose = require("mongoose");
const {
  JOB_APPLICATION_STATUSES,
  JobApplication,
} = require("../Models/jobApplicationModel");

const allowedUpdateFields = [
  "company",
  "role",
  "status",
  "location",
  "jobUrl",
  "dateApplied",
  "nextStepDate",
  "stage",
  "notes",
  "jobDescription",
];

const requiredFields = ["company", "role"];
const dateFields = new Set(["dateApplied", "nextStepDate"]);
const optionalFields = new Set([
  "location",
  "jobUrl",
  "dateApplied",
  "nextStepDate",
  "stage",
  "notes",
  "jobDescription",
]);

const getRequestUserId = (req) => (
  req.user?.user_id || req.user?.id || req.user?.security_personnel_id
);

const isBlank = (value) => (
  value === undefined || value === null || String(value).trim() === ""
);

const sendControllerError = (res, err) => {
  if (err.name === "ValidationError" || err.name === "CastError") {
    return res.status(400).json({ message: err.message });
  }

  return res.status(500).json({ message: err.message });
};

const normalizeDateValue = (value, fieldName) => {
  if (value === undefined) return { hasValue: false };
  if (value === null || value === "") return { hasValue: true, value: null };

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      hasValue: true,
      error: `${fieldName} must be a valid date`,
    };
  }

  return { hasValue: true, value: date };
};

const buildJobApplicationPayload = (body, options = {}) => {
  const payload = {};
  const source = body || {};

  for (const field of allowedUpdateFields) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;

    if (dateFields.has(field)) {
      const normalizedDate = normalizeDateValue(source[field], field);
      if (normalizedDate.error) return { error: normalizedDate.error };
      if (normalizedDate.hasValue) payload[field] = normalizedDate.value;
      continue;
    }

    if (source[field] === null && optionalFields.has(field)) {
      payload[field] = null;
      continue;
    }

    payload[field] =
      typeof source[field] === "string" ? source[field].trim() : source[field];
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "status") &&
    !JOB_APPLICATION_STATUSES.includes(payload.status)
  ) {
    return {
      error: `status must be one of ${JOB_APPLICATION_STATUSES.join(", ")}`,
    };
  }

  for (const field of requiredFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field) && isBlank(payload[field])) {
      return { error: `${field} is required` };
    }
  }

  return { payload };
};

const getJobApplications = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: "Access token required" });

    const jobApplications = await JobApplication.find({ userId })
      .sort({ updatedAt: -1, createdAt: -1 });

    return res.json({ jobApplications });
  } catch (err) {
    return sendControllerError(res, err);
  }
};

const createJobApplication = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: "Access token required" });

    if (isBlank(req.body?.company)) {
      return res.status(400).json({ message: "company is required" });
    }

    if (isBlank(req.body?.role)) {
      return res.status(400).json({ message: "role is required" });
    }

    const { payload, error } = buildJobApplicationPayload(req.body);
    if (error) return res.status(400).json({ message: error });

    const jobApplication = await JobApplication.create({
      ...payload,
      userId,
    });

    return res.status(201).json({ jobApplication });
  } catch (err) {
    return sendControllerError(res, err);
  }
};

const updateJobApplication = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: "Access token required" });

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Job application not found" });
    }

    const { payload, error } = buildJobApplicationPayload(req.body, { partial: true });
    if (error) return res.status(400).json({ message: error });

    if (Object.keys(payload).length === 0) {
      const existingJobApplication = await JobApplication.findOne({ _id: id, userId });
      if (!existingJobApplication) {
        return res.status(404).json({ message: "Job application not found" });
      }

      return res.json({ jobApplication: existingJobApplication });
    }

    const jobApplication = await JobApplication.findOneAndUpdate(
      { _id: id, userId },
      { $set: payload },
      { new: true, runValidators: true }
    );

    if (!jobApplication) {
      return res.status(404).json({ message: "Job application not found" });
    }

    return res.json({ jobApplication });
  } catch (err) {
    return sendControllerError(res, err);
  }
};

const deleteJobApplication = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: "Access token required" });

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Job application not found" });
    }

    const deleted = await JobApplication.findOneAndDelete({ _id: id, userId });
    if (!deleted) {
      return res.status(404).json({ message: "Job application not found" });
    }

    return res.json({
      success: true,
      id: String(deleted._id),
    });
  } catch (err) {
    return sendControllerError(res, err);
  }
};

module.exports = {
  getJobApplications,
  createJobApplication,
  updateJobApplication,
  deleteJobApplication,
};
