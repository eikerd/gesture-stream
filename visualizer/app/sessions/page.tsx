import { prisma } from "@/lib/prisma";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const sessions = await prisma.session.findMany({
    include: { reps: true },
    orderBy: { startedAt: "desc" },
    take: 100,
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="flex items-center gap-4 px-6 py-3 border-b border-zinc-800 bg-zinc-900">
        <Link
          href="/"
          className="font-mono font-semibold text-zinc-100 tracking-tight hover:text-zinc-300 transition-colors"
        >
          pose.stream
        </Link>
        <span className="text-zinc-600">/</span>
        <span className="text-sm text-zinc-400">Session History</span>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        <h1 className="text-xl font-semibold text-zinc-100 mb-6">
          Past Sessions
        </h1>

        {sessions.length === 0 ? (
          <div className="text-center py-20 text-zinc-500">
            <p className="text-sm">No sessions recorded yet.</p>
            <p className="text-xs mt-1">
              Sessions are created when a WebSocket connection is established.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-zinc-800 bg-zinc-900">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">Session ID</TableHead>
                  <TableHead className="text-zinc-400">Exercise</TableHead>
                  <TableHead className="text-zinc-400">Started</TableHead>
                  <TableHead className="text-zinc-400">Ended</TableHead>
                  <TableHead className="text-zinc-400 text-right">
                    Reps
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => {
                  const duration =
                    session.endedAt
                      ? Math.round(
                          (session.endedAt.getTime() -
                            session.startedAt.getTime()) /
                            1000
                        )
                      : null;

                  return (
                    <TableRow
                      key={session.id}
                      className="border-zinc-800 hover:bg-zinc-800/50"
                    >
                      <TableCell className="font-mono text-xs text-zinc-400">
                        {session.id.slice(0, 8)}...
                      </TableCell>
                      <TableCell>
                        {session.exercise ? (
                          <Badge variant="secondary" className="text-xs">
                            {session.exercise}
                          </Badge>
                        ) : (
                          <span className="text-zinc-600 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-300">
                        {session.startedAt.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-300">
                        {session.endedAt ? (
                          <>
                            {session.endedAt.toLocaleString()}
                            {duration !== null && (
                              <span className="text-zinc-500 ml-1">
                                ({duration}s)
                              </span>
                            )}
                          </>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-xs border-zinc-600 text-zinc-400"
                          >
                            In progress
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-zinc-100">
                        {session.reps.length}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </div>
  );
}
