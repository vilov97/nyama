import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import AuthLayout from "../auth/AuthLayout";
import { homeForRole } from "../auth/roles";

/** 403 — reached when a signed-in user opens a portal outside their role. */
export default function ForbiddenPage() {
  const { user, role, signOutEverywhere } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOutEverywhere();
    navigate("/login", { replace: true });
  };

  return (
    <AuthLayout kicker="403 · Not authorized" title="Wrong portal for this account">
      <p className="mb-2 text-sm leading-relaxed text-neutral-600">
        {user ? (
          <>
            You&apos;re signed in as{" "}
            <span className="font-bold">{user.email}</span>
            {role && (
              <>
                {" "}with the <span className="font-bold">{role}</span> role
              </>
            )}
            , which doesn&apos;t have access to this area.
          </>
        ) : (
          <>You need to sign in to access this area.</>
        )}
      </p>
      <p className="mb-6 text-xs text-neutral-400">
        If you believe this is a mistake, ask an admin to check your role.
        Every denied access is logged.
      </p>
      <div className="flex flex-col gap-2">
        {user && role && (
          <Link
            to={homeForRole(role)}
            className="block bg-[#ffe500] px-5 py-3 text-center text-xs font-bold uppercase tracking-wider text-neutral-900 no-underline transition-all hover:bg-neutral-900 hover:text-white"
          >
            Go to my portal
          </Link>
        )}
        <Link
          to="/"
          className="block border border-neutral-300 px-5 py-3 text-center text-xs font-bold uppercase tracking-wider text-neutral-700 no-underline transition-all hover:border-neutral-900"
        >
          Back to home
        </Link>
        {user && (
          <button
            onClick={handleSignOut}
            className="cursor-pointer py-1 text-center text-xs text-neutral-500 underline hover:text-neutral-900"
          >
            Sign out
          </button>
        )}
      </div>
    </AuthLayout>
  );
}
