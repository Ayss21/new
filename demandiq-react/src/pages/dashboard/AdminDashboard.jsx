// Admin dashboard: module activity summary, user activity insights and recent events.
// Every figure is calculated from the activity log (GET /activity), which is reloaded when the dashboard opens
// because other people's actions add to it.
import { useEffect, useMemo, useState } from "react";
import { activityByRole, activityByUser, moduleActivitySummary } from "../../lib/activity";
import { formatDateTime } from "../../lib/format";
import { roleName } from "../../lib/roles";
import { useStore } from "../../store/AppStore";
import { Card, CardHeader, EmptyState, MultiSelect, SearchBox, Status, TableFooter, paginate, useFitRows } from "../../components/ui";

const pct = (rate) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

function ModuleActivitySummary({ activity }) {
  const rows = moduleActivitySummary(activity);
  const hasData = rows.some((row) => row.total > 0);
  return (
    <Card className="admin-module-card">
      <CardHeader title="Module activity summary" subtitle={`${activity.length.toLocaleString()} recorded events`} />
      {hasData ? (
        <div className="table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>Module</th>
                <th className="num">Total activities</th>
                <th className="num">Successful</th>
                <th className="num">Failed</th>
                <th>Success rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.module}>
                  <td>
                    <strong>{row.module}</strong>
                  </td>
                  <td className="num">{row.total}</td>
                  <td className="num">{row.successful}</td>
                  <td className="num">{row.failed}</td>
                  <td>
                    <div className="rate-cell" title={`${row.successful} of ${row.total} completed`}>
                      <i>
                        <b style={{ width: `${(row.successRate ?? 0) * 100}%` }} />
                      </i>
                      <span>{pct(row.successRate)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState inline title="No activity yet" detail="Events appear here as people use the platform." />
      )}
    </Card>
  );
}

function UserActivityInsights({ activity, users }) {
  const byRole = activityByRole(activity);
  const max = Math.max(...byRole.map((r) => r.count), 1);
  // Every user, the most active first (accounts without activity show 0)
  const everyone = activityByUser(activity, users);
  return (
    <Card className="admin-insights-card">
      <CardHeader title="User activity insights" subtitle="By role and by user" />
      {everyone.length ? (
        <div className="insights-body">
          <div className="role-bars" role="list" aria-label="Activity count by role">
            {byRole.map((row) => (
              <div className="role-bar-row" role="listitem" key={row.roleId} title={`${row.label}: ${row.count} activities`}>
                <span>{row.label}</span>
                <div>
                  <i style={{ width: `${(row.count / max) * 100}%` }} />
                </div>
                <strong>{row.count}</strong>
              </div>
            ))}
          </div>
          <div className="table-wrap user-totals" tabIndex={0} aria-label={`Activity of all ${everyone.length} users`}>
            <table className="compact-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {everyone.map((user) => (
                  <tr key={user.userId}>
                    <td title={user.userId}>
                      <strong>{user.userName}</strong>
                    </td>
                    <td>{roleName(user.roleId)}</td>
                    <td className="num">{user.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState inline title="No user activity yet" detail="Activity by role appears once people sign in." />
      )}
    </Card>
  );
}

function RecentEvents({ activity }) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState([]); // modules ([] = all)
  const [page, setPage] = useState(1);
  const modules = useMemo(() => [...new Set(activity.map((row) => row.module))].sort(), [activity]);
  const q = search.trim().toLowerCase();
  const rows = activity.filter(
    (row) =>
      (!picked.length || picked.includes(row.module)) &&
      (!q ||
        [formatDateTime(row.at), row.userName, row.roleId ? roleName(row.roleId) : "", row.action, row.module, row.details, row.status]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
  const [eventsTable, pageSize] = useFitRows({ min: 4 });
  const pageData = paginate(rows, page, pageSize);
  return (
    <Card className="admin-events-card">
      <CardHeader
        title="Recent administrative events"
        subtitle="Activity records"
        action={
          <div className="table-tools">
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search events"
            />
            <MultiSelect
              ariaLabel="Module"
              allLabel="All modules"
              options={modules}
              value={picked}
              summary={(n) => `${n} modules`}
              onChange={(v) => {
                setPicked(v);
                setPage(1);
              }}
            />
          </div>
        }
      />
      <div className="table-wrap">
        <table ref={eventsTable}>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Role</th>
              <th>Action</th>
              <th>Module</th>
              <th>Details</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageData.rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.at)}</td>
                <td>{row.userName}</td>
                <td>{row.roleId ? roleName(row.roleId) : "—"}</td>
                <td>{row.action}</td>
                <td>{row.module}</td>
                <td className="details-cell" title={row.details}>
                  {row.details || "—"}
                </td>
                <td>
                  <Status value={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <EmptyState inline title="No events found" detail="Try a different search or module." />}
      </div>
      <TableFooter label={pageData.label} page={pageData.page} pageCount={pageData.pageCount} onPage={setPage} />
    </Card>
  );
}

export function AdminDashboard() {
  const { activity, users, refresh } = useStore();
  useEffect(() => {
    refresh(["activity", "users"]);
  }, [refresh]);
  return (
    <div className="admin-dashboard">
      <div className="admin-row">
        <ModuleActivitySummary activity={activity} />
        <UserActivityInsights activity={activity} users={users} />
      </div>
      <RecentEvents activity={activity} />
    </div>
  );
}
