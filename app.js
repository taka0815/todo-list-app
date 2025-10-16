const FINISHED_LABEL = "終了";
const STORAGE_KEY = "vue-task-board";
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const STATUS_LABELS = [
  "未着手",
  "判断待ち",
  "処理中",
  "レビュー待ち",
  "テストケース作成中",
  "テスト中",
  FINISHED_LABEL,
];

const STATUS_META = {
  未着手: { key: "not-started" },
  判断待ち: { key: "waiting" },
  処理中: { key: "in-progress" },
  レビュー待ち: { key: "review" },
  テストケース作成中: { key: "test-prep" },
  テスト中: { key: "testing" },
  [FINISHED_LABEL]: { key: "done" },
};

const makeId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;

Vue.createApp({
  data() {
    return {
      statusLabels: STATUS_LABELS,
      finishedLabel: FINISHED_LABEL,
      tasks: [],
      newTaskTitle: "",
      newTaskStatus: STATUS_LABELS[0],
      selectedTaskId: null,
      newCommentText: "",
      editingCommentId: null,
      editingCommentText: "",
      purgeTimer: null,
      draggingTaskId: null,
      dragOverStatus: null,
      statusMeta: STATUS_META,
    };
  },
  computed: {
    tasksByStatus() {
      const grouped = {};
      this.statusLabels.forEach((status) => {
        grouped[status] = [];
      });
      this.tasks
        .slice()
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )
        .forEach((task) => {
          if (!grouped[task.status]) {
            grouped[task.status] = [];
          }
          grouped[task.status].push(task);
        });
      return grouped;
    },
    selectedTask() {
      return this.tasks.find((task) => task.id === this.selectedTaskId) || null;
    },
  },
  created() {
    this.loadTasks();
    this.purgeExpiredFinishedTasks();
    this.startPurgeTimer();
  },
  beforeUnmount() {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
    }
  },
  methods: {
    loadTasks() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            this.tasks = parsed.map((task) => ({
              comments: [],
              completedAt: null,
              ...task,
            }));
          }
        }
      } catch (error) {
        console.error("タスクの読み込みに失敗しました", error);
        this.tasks = [];
      }
    },
    persistTasks() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tasks));
    },
    handleAddTask() {
      const title = this.newTaskTitle.trim();
      if (!title) return;
      const status = this.statusLabels.includes(this.newTaskStatus)
        ? this.newTaskStatus
        : this.statusLabels[0];
      const now = new Date().toISOString();
      this.tasks.push({
        id: makeId(),
        title,
        status,
        createdAt: now,
        completedAt: status === this.finishedLabel ? now : null,
        comments: [],
      });
      this.persistTasks();
      this.newTaskTitle = "";
      this.newTaskStatus = this.statusLabels[0];
    },
    selectTask(taskId) {
      this.selectedTaskId = taskId;
      this.editingCommentId = null;
      this.editingCommentText = "";
      this.newCommentText = "";
    },
    startDrag(taskId, event) {
      this.draggingTaskId = taskId;
      if (event && event.dataTransfer) {
        event.dataTransfer.setData("text/plain", taskId);
        event.dataTransfer.effectAllowed = "move";
      }
    },
    endDrag() {
      this.draggingTaskId = null;
      this.dragOverStatus = null;
    },
    onDragEnter(status, event) {
      if (!this.draggingTaskId) return;
      if (event && event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      this.dragOverStatus = status;
    },
    onDrop(status) {
      if (!this.draggingTaskId) return;
      this.setTaskStatus(this.draggingTaskId, status);
      this.endDrag();
    },
    statusClass(status) {
      const meta = this.statusMeta[status];
      return meta ? `status-${meta.key}` : "status-generic";
    },
    setTaskStatus(taskId, status) {
      if (!this.statusLabels.includes(status)) {
        return;
      }
      this.updateTaskStatus(taskId, status);
    },
    updateTaskStatus(taskId, nextStatus) {
      const task = this.tasks.find((item) => item.id === taskId);
      if (!task || !this.statusLabels.includes(nextStatus)) {
        return;
      }
      const previousStatus = task.status;
      task.status = nextStatus;
      if (nextStatus === this.finishedLabel) {
        task.completedAt = task.completedAt || new Date().toISOString();
      } else if (previousStatus === this.finishedLabel) {
        task.completedAt = null;
      }
      this.persistTasks();
      this.purgeExpiredFinishedTasks();
    },
    addComment() {
      const task = this.selectedTask;
      if (!task) return;
      const text = this.newCommentText.trim();
      if (!text) return;
      const now = new Date().toISOString();
      task.comments.push({
        id: makeId(),
        text,
        createdAt: now,
        updatedAt: null,
      });
      this.persistTasks();
      this.newCommentText = "";
    },
    startCommentEdit(commentId, text) {
      this.editingCommentId = commentId;
      this.editingCommentText = text;
    },
    cancelCommentEdit() {
      this.editingCommentId = null;
      this.editingCommentText = "";
    },
    saveCommentEdit(commentId) {
      const task = this.selectedTask;
      if (!task) return;
      const comment = task.comments.find((item) => item.id === commentId);
      if (!comment) return;
      const trimmed = this.editingCommentText.trim();
      if (!trimmed) return;
      comment.text = trimmed;
      comment.updatedAt = new Date().toISOString();
      this.persistTasks();
      this.cancelCommentEdit();
    },
    deleteComment(commentId) {
      const task = this.selectedTask;
      if (!task) return;
      const index = task.comments.findIndex((item) => item.id === commentId);
      if (index === -1) return;
      task.comments.splice(index, 1);
      if (this.editingCommentId === commentId) {
        this.cancelCommentEdit();
      }
      this.persistTasks();
    },
    purgeExpiredFinishedTasks() {
      const now = Date.now();
      let changed = false;
      this.tasks = this.tasks.filter((task) => {
        if (
          task.status === this.finishedLabel &&
          task.completedAt &&
          now - new Date(task.completedAt).getTime() > TWO_WEEKS_MS
        ) {
          if (task.id === this.selectedTaskId) {
            this.selectedTaskId = null;
          }
          changed = true;
          return false;
        }
        return true;
      });
      if (changed) {
        this.persistTasks();
      }
    },
    deleteTask(taskId) {
      const exists = this.tasks.some((task) => task.id === taskId);
      if (!exists) return;
      const message = "このタスクを削除しますか？";
      if (
        typeof window !== "undefined" &&
        typeof window.confirm === "function" &&
        !window.confirm(message)
      ) {
        return;
      }
      this.tasks = this.tasks.filter((task) => task.id !== taskId);
      if (this.selectedTaskId === taskId) {
        this.selectedTaskId = null;
      }
      this.persistTasks();
    },
    startPurgeTimer() {
      this.purgeTimer = setInterval(
        () => this.purgeExpiredFinishedTasks(),
        60 * 60 * 1000
      );
    },
    formatDate(isoString) {
      if (!isoString) return "";
      const date = new Date(isoString);
      if (Number.isNaN(date.getTime())) return "";
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const hh = String(date.getHours()).padStart(2, "0");
      const min = String(date.getMinutes()).padStart(2, "0");
      return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
    },
  },
}).mount("#app");
